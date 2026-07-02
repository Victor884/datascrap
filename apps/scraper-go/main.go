package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Job struct {
	Source         string   `json:"source"`
	Title          string   `json:"title"`
	Description    string   `json:"description,omitempty"`
	Company        string   `json:"company"`
	CompanyLogo    string   `json:"company_logo,omitempty"`
	Location       string   `json:"location"`
	URL            string   `json:"url"`
	Tags           []string `json:"tags,omitempty"`
	PostedAt       string   `json:"posted_at,omitempty"`
	SalaryMin      float64  `json:"salary_min,omitempty"`
	SalaryMax      float64  `json:"salary_max,omitempty"`
	SalaryCurrency string   `json:"salary_currency,omitempty"`
	SalaryPeriod   string   `json:"salary_period,omitempty"`
}

type Source interface {
	Name() string
	Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error)
}

type RemoteOKSource struct{}

func (RemoteOKSource) Name() string { return "remoteok" }

func (RemoteOKSource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	endpoint := "https://remoteok.com/api"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "datascrap/0.1 (+https://github.com/local/datascrap)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remoteok returned status %s", resp.Status)
	}

	var raw []struct {
		Position string   `json:"position"`
		Company  string   `json:"company"`
		Location string   `json:"location"`
		URL      string   `json:"url"`
		Slug     string   `json:"slug"`
		Tags     []string `json:"tags"`
		Date     string   `json:"date"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	var jobs []Job
	for _, item := range raw {
		if item.Position == "" {
			continue
		}
		jobURL := item.URL
		if jobURL == "" && item.Slug != "" {
			jobURL = "https://remoteok.com/remote-jobs/" + item.Slug
		}
		job := Job{
			Source:   "remoteok",
			Title:    strings.TrimSpace(item.Position),
			Company:  strings.TrimSpace(item.Company),
			Location: strings.TrimSpace(item.Location),
			URL:      jobURL,
			Tags:     cleanTags(item.Tags),
			PostedAt: item.Date,
		}
		if matchesTargetJob(job, query) {
			jobs = append(jobs, job)
		}
	}
	return jobs, nil
}

type ArbeitnowSource struct{}

func (ArbeitnowSource) Name() string { return "arbeitnow" }

func (ArbeitnowSource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	endpoint := "https://www.arbeitnow.com/api/job-board-api"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "datascrap/0.1")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("arbeitnow returned status %s", resp.Status)
	}

	var payload struct {
		Data []struct {
			Slug      string   `json:"slug"`
			Company   string   `json:"company_name"`
			Title     string   `json:"title"`
			Location  string   `json:"location"`
			Remote    bool     `json:"remote"`
			URL       string   `json:"url"`
			Tags      []string `json:"tags"`
			CreatedAt int64    `json:"created_at"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	var jobs []Job
	for _, item := range payload.Data {
		location := strings.TrimSpace(item.Location)
		if location == "" {
			location = "On-site"
		}
		if item.Remote {
			if location == "" || location == "On-site" {
				location = "Remote"
			} else {
				location = "Remote - " + location
			}
		}
		postedAt := ""
		if item.CreatedAt > 0 {
			postedAt = time.Unix(item.CreatedAt, 0).Format(time.RFC3339)
		}
		job := Job{
			Source:   "arbeitnow",
			Title:    strings.TrimSpace(item.Title),
			Company:  strings.TrimSpace(item.Company),
			Location: location,
			URL:      item.URL,
			Tags:     cleanTags(item.Tags),
			PostedAt: postedAt,
		}
		if matchesTargetJob(job, query) {
			jobs = append(jobs, job)
		}
	}
	return jobs, nil
}

type RemotiveSource struct{}

func (RemotiveSource) Name() string { return "remotive" }

func (RemotiveSource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	var allJobs []Job
	for _, keyword := range queryKeywords(query) {
		jobs, err := fetchRemotive(ctx, client, keyword)
		if err != nil {
			return nil, err
		}
		allJobs = append(allJobs, jobs...)
	}
	return dedupeJobs(allJobs), nil
}

func fetchRemotive(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	values := url.Values{}
	values.Set("search", query)
	endpoint := "https://remotive.com/api/remote-jobs?" + values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "datascrap/0.1")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remotive returned status %s", resp.Status)
	}

	var payload struct {
		Jobs []struct {
			Title                     string   `json:"title"`
			CompanyName               string   `json:"company_name"`
			URL                       string   `json:"url"`
			JobType                   string   `json:"job_type"`
			Tags                      []string `json:"tags"`
			CandidateRequiredLocation string   `json:"candidate_required_location"`
			Publication               string   `json:"publication_date"`
		} `json:"jobs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	var jobs []Job
	for _, item := range payload.Jobs {
		location := strings.TrimSpace(item.CandidateRequiredLocation)
		if location == "" {
			location = "Remote"
		}
		job := Job{
			Source:   "remotive",
			Title:    strings.TrimSpace(item.Title),
			Company:  strings.TrimSpace(item.CompanyName),
			Location: location,
			URL:      item.URL,
			Tags:     cleanTags(append(item.Tags, item.JobType)),
			PostedAt: item.Publication,
		}
		if matchesTargetJob(job, query) {
			jobs = append(jobs, job)
		}
	}
	return jobs, nil
}

type JobicySource struct{}

func (JobicySource) Name() string { return "jobicy" }

func (JobicySource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	var allJobs []Job
	for _, keyword := range jobicyKeywords(query) {
		values := url.Values{}
		values.Set("count", "20")
		values.Set("tag", keyword)
		endpoint := "https://jobicy.com/api/v2/remote-jobs?" + values.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "datascrap/0.1")

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		var payload struct {
			Jobs []struct {
				URL            string   `json:"url"`
				JobTitle       string   `json:"jobTitle"`
				CompanyName    string   `json:"companyName"`
				CompanyLogo    string   `json:"companyLogo"`
				JobIndustry    []string `json:"jobIndustry"`
				JobType        []string `json:"jobType"`
				JobGeo         string   `json:"jobGeo"`
				JobLevel       string   `json:"jobLevel"`
				JobExcerpt     string   `json:"jobExcerpt"`
				JobDescription string   `json:"jobDescription"`
				PubDate        string   `json:"pubDate"`
				SalaryMin      float64  `json:"salaryMin"`
				SalaryMax      float64  `json:"salaryMax"`
				SalaryCurrency string   `json:"salaryCurrency"`
				SalaryPeriod   string   `json:"salaryPeriod"`
			} `json:"jobs"`
		}

		if resp.StatusCode == http.StatusNotFound {
			resp.Body.Close()
			continue
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			resp.Body.Close()
			break
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("jobicy returned status %s", resp.Status)
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()

		for _, item := range payload.Jobs {
			tags := cleanTags(append(append(item.JobIndustry, item.JobType...), item.JobLevel))
			job := Job{
				Source:         "jobicy",
				Title:          strings.TrimSpace(item.JobTitle),
				Description:    stripHTML(strings.Join([]string{item.JobExcerpt, item.JobDescription}, " ")),
				Company:        strings.TrimSpace(item.CompanyName),
				CompanyLogo:    strings.TrimSpace(item.CompanyLogo),
				Location:       "Remote - " + strings.TrimSpace(item.JobGeo),
				URL:            item.URL,
				Tags:           tags,
				PostedAt:       item.PubDate,
				SalaryMin:      item.SalaryMin,
				SalaryMax:      item.SalaryMax,
				SalaryCurrency: strings.TrimSpace(item.SalaryCurrency),
				SalaryPeriod:   strings.TrimSpace(item.SalaryPeriod),
			}
			extra := strings.Join([]string{item.JobExcerpt, item.JobDescription}, " ")
			if matchesTargetJobWithExtra(job, query, extra) {
				allJobs = append(allJobs, job)
			}
		}

		time.Sleep(750 * time.Millisecond)
	}
	return dedupeJobs(allJobs), nil
}

type TheMuseSource struct{}

func (TheMuseSource) Name() string { return "themuse" }

func (TheMuseSource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	var allJobs []Job
	for _, keyword := range queryKeywords(query) {
		values := url.Values{}
		values.Set("page", "1")
		values.Set("keyword", keyword)
		endpoint := "https://www.themuse.com/api/public/jobs?" + values.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "datascrap/0.1")

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		var payload struct {
			Results []struct {
				Name            string `json:"name"`
				PublicationDate string `json:"publication_date"`
				Contents        string `json:"contents"`
				Locations       []struct {
					Name string `json:"name"`
				} `json:"locations"`
				Levels []struct {
					Name string `json:"name"`
				} `json:"levels"`
				Categories []struct {
					Name string `json:"name"`
				} `json:"categories"`
				Refs struct {
					LandingPage string `json:"landing_page"`
				} `json:"refs"`
				Company struct {
					Name string `json:"name"`
				} `json:"company"`
			} `json:"results"`
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("themuse returned status %s", resp.Status)
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()

		for _, item := range payload.Results {
			locationNames := make([]string, 0, len(item.Locations))
			for _, location := range item.Locations {
				locationNames = append(locationNames, location.Name)
			}
			tags := make([]string, 0, len(item.Levels)+len(item.Categories))
			for _, level := range item.Levels {
				tags = append(tags, level.Name)
			}
			for _, category := range item.Categories {
				tags = append(tags, category.Name)
			}

			job := Job{
				Source:   "themuse",
				Title:    strings.TrimSpace(item.Name),
				Company:  strings.TrimSpace(item.Company.Name),
				Location: strings.Join(locationNames, " | "),
				URL:      item.Refs.LandingPage,
				Tags:     cleanTags(tags),
				PostedAt: item.PublicationDate,
			}
			if matchesTargetJobWithExtra(job, query, item.Contents) {
				allJobs = append(allJobs, job)
			}
		}
	}
	return dedupeJobs(allJobs), nil
}

type AdzunaSource struct {
	AppID  string
	AppKey string
}

func (AdzunaSource) Name() string { return "adzuna" }

func (source AdzunaSource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	var allJobs []Job
	for _, keyword := range queryKeywords(query) {
		values := url.Values{}
		values.Set("app_id", source.AppID)
		values.Set("app_key", source.AppKey)
		values.Set("results_per_page", "50")
		values.Set("what", keyword)
		values.Set("where", "Brazil")
		values.Set("content-type", "application/json")
		endpoint := "https://api.adzuna.com/v1/api/jobs/br/search/1?" + values.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "datascrap/0.1")

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		var payload struct {
			Results []struct {
				Title   string `json:"title"`
				Company struct {
					DisplayName string `json:"display_name"`
				} `json:"company"`
				Location struct {
					DisplayName string `json:"display_name"`
				} `json:"location"`
				RedirectURL string `json:"redirect_url"`
				Created     string `json:"created"`
				Description string `json:"description"`
				Category    struct {
					Label string `json:"label"`
				} `json:"category"`
			} `json:"results"`
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("adzuna returned status %s", resp.Status)
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()

		for _, item := range payload.Results {
			job := Job{
				Source:      "adzuna",
				Title:       strings.TrimSpace(item.Title),
				Description: stripHTML(item.Description),
				Company:     strings.TrimSpace(item.Company.DisplayName),
				Location:    strings.TrimSpace(item.Location.DisplayName),
				URL:         item.RedirectURL,
				Tags:        cleanTags([]string{item.Category.Label}),
				PostedAt:    item.Created,
			}
			if matchesTargetJobWithExtra(job, query, item.Description) {
				allJobs = append(allJobs, job)
			}
		}
	}
	return dedupeJobs(allJobs), nil
}

type SerpAPISource struct {
	APIKey string
}

func (SerpAPISource) Name() string { return "serpapi-linkedin-gupy-indeed" }

func (source SerpAPISource) Fetch(ctx context.Context, client *http.Client, query string) ([]Job, error) {
	targets := []struct {
		Source string
		Site   string
	}{
		{Source: "linkedin", Site: "linkedin.com/jobs"},
		{Source: "gupy", Site: "gupy.io"},
		{Source: "indeed", Site: "br.indeed.com"},
	}

	var allJobs []Job
	for _, keyword := range queryKeywords(query) {
		for _, target := range targets {
			searches := []string{
				fmt.Sprintf("site:%s %s remoto Brasil", target.Site, keyword),
				fmt.Sprintf("site:%s %s Brasilia DF", target.Site, keyword),
			}
			for _, search := range searches {
				jobs, err := source.fetchSearch(ctx, client, target.Source, search, query)
				if err != nil {
					return nil, err
				}
				allJobs = append(allJobs, jobs...)
				time.Sleep(400 * time.Millisecond)
			}
		}
	}
	return dedupeJobs(allJobs), nil
}

func (source SerpAPISource) fetchSearch(ctx context.Context, client *http.Client, sourceName string, search string, query string) ([]Job, error) {
	values := url.Values{}
	values.Set("engine", "google")
	values.Set("q", search)
	values.Set("google_domain", "google.com.br")
	values.Set("gl", "br")
	values.Set("hl", "pt-br")
	values.Set("num", "10")
	values.Set("api_key", source.APIKey)
	endpoint := "https://serpapi.com/search.json?" + values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "datascrap/0.1")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("serpapi returned status %s", resp.Status)
	}

	var payload struct {
		OrganicResults []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
			Source  string `json:"source"`
		} `json:"organic_results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	var jobs []Job
	for _, item := range payload.OrganicResults {
		job := Job{
			Source:   sourceName,
			Title:    strings.TrimSpace(item.Title),
			Company:  strings.TrimSpace(item.Source),
			Location: inferLocation(item.Title + " " + item.Snippet),
			URL:      item.Link,
			Tags:     cleanTags([]string{"serpapi"}),
		}
		if matchesTargetJobWithExtra(job, query, item.Snippet) {
			jobs = append(jobs, job)
		}
	}
	return jobs, nil
}

func main() {
	query := flag.String("query", "engenheiro de dados junior,engenheiro dados junior,engenheiro de dados jr,analista de dados junior,analista dados junior,analista de dados jr,desenvolvedor python,junior data engineer,data engineer junior,junior data analyst,data analyst junior,python developer,etl,elt,pipeline de dados,data pipeline,data warehouse,data lake,python,sql,pyspark,apache spark,databricks,ibm datastage,apache airflow,db2,postgresql,mysql,power bi,n8n,power automate,selenium,rest api,json,gcp,docker,kafka", "comma-separated job and technology keywords")
	format := flag.String("format", "csv", "output format: csv or json")
	out := flag.String("out", "data/raw/vagas-dados.csv", "output file path")
	timeout := flag.Duration("timeout", 90*time.Second, "request timeout")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "Erro ao criar diretório de saída: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	client := &http.Client{Timeout: *timeout}
	sources := []Source{
		RemoteOKSource{},
		ArbeitnowSource{},
		RemotiveSource{},
		JobicySource{},
		TheMuseSource{},
	}
	if appID, appKey := os.Getenv("ADZUNA_APP_ID"), os.Getenv("ADZUNA_APP_KEY"); appID != "" && appKey != "" {
		sources = append(sources, AdzunaSource{AppID: appID, AppKey: appKey})
	} else {
		fmt.Println("[info] Adzuna desativado: defina ADZUNA_APP_ID e ADZUNA_APP_KEY para buscar tambem nesse site")
	}
	if apiKey := os.Getenv("SERPAPI_KEY"); apiKey != "" {
		sources = append(sources, SerpAPISource{APIKey: apiKey})
	} else {
		fmt.Println("[info] LinkedIn/Gupy/Indeed desativados: defina SERPAPI_KEY para buscar nesses sites sem automacao evasiva")
	}

	var allJobs []Job
	for _, source := range sources {
		stopLoading := startLoading(fmt.Sprintf("Buscando vagas em %s", source.Name()))
		jobs, err := source.Fetch(ctx, client, *query)
		stopLoading()
		if err != nil {
			fmt.Printf("[erro] %s: %v\n", source.Name(), err)
			continue
		}
		fmt.Printf("[ok] %s encontrou %d vagas compativeis\n", source.Name(), len(jobs))
		allJobs = append(allJobs, jobs...)
	}

	allJobs = dedupeJobs(allJobs)
	sort.Slice(allJobs, func(i, j int) bool {
		if allJobs[i].PostedAt == allJobs[j].PostedAt {
			return allJobs[i].Title < allJobs[j].Title
		}
		return allJobs[i].PostedAt > allJobs[j].PostedAt
	})

	fmt.Println("Salvando resultado...")
	if err := writeJobs(*out, *format, allJobs); err != nil {
		fmt.Fprintf(os.Stderr, "Erro ao salvar arquivo: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Pronto: %d vagas salvas em %s\n", len(allJobs), *out)
}

func startLoading(message string) func() {
	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		frames := []string{"|", "/", "-", "\\"}
		ticker := time.NewTicker(120 * time.Millisecond)
		defer ticker.Stop()

		i := 0
		for {
			select {
			case <-done:
				fmt.Printf("\r%s... concluido%s\n", message, strings.Repeat(" ", 12))
				return
			case <-ticker.C:
				fmt.Printf("\r%s... %s", message, frames[i%len(frames)])
				i++
			}
		}
	}()

	return func() {
		close(done)
		<-stopped
	}
}

func matchesTargetJob(job Job, query string) bool {
	return matchesTargetJobWithExtra(job, query, "")
}

func matchesTargetJobWithExtra(job Job, query string, extra string) bool {
	return matchesRole(job, query, extra) && matchesLocationRule(job, extra)
}

func matchesRole(job Job, query string, extra string) bool {
	haystack := normalizeText(strings.Join([]string{
		job.Title,
		job.Company,
		job.Location,
		strings.Join(job.Tags, " "),
		extra,
	}, " "))

	for _, keyword := range queryKeywords(query) {
		keyword = normalizeText(keyword)
		if keyword != "" && strings.Contains(haystack, keyword) {
			return true
		}
	}
	return false
}

func queryKeywords(query string) []string {
	seen := map[string]bool{}
	var out []string
	for _, keyword := range strings.Split(query, ",") {
		keyword = strings.TrimSpace(keyword)
		key := normalizeText(keyword)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, keyword)
	}
	return out
}

func jobicyKeywords(query string) []string {
	preferred := []string{
		"python",
		"sql",
		"data engineer",
		"data analyst",
		"pyspark",
		"apache spark",
		"databricks",
		"apache airflow",
		"docker",
		"gcp",
	}

	available := map[string]bool{}
	for _, keyword := range queryKeywords(query) {
		available[normalizeText(keyword)] = true
	}

	var out []string
	for _, keyword := range preferred {
		if available[normalizeText(keyword)] {
			out = append(out, keyword)
		}
	}
	if len(out) == 0 {
		return queryKeywords(query)
	}
	return out
}

func matchesLocationRule(job Job, extra string) bool {
	text := normalizeText(strings.Join([]string{
		job.Title,
		job.Location,
		strings.Join(job.Tags, " "),
		extra,
	}, " "))

	if isBrasilia(text) {
		return true
	}
	if isRemote(text) && isBrazilOrLatam(text) {
		return true
	}
	return false
}

func isRemote(text string) bool {
	return containsAny(text, []string{
		"remote",
		"remoto",
		"work from home",
		"home office",
	})
}

func isBrazilOrLatam(text string) bool {
	return containsAny(text, []string{
		"brasil",
		"brazil",
		" brazil ",
		" br ",
		"br/",
		"/br",
		"latam",
		"latin america",
		"america latina",
	})
}

func isBrasilia(text string) bool {
	return containsAny(text, []string{
		"brasilia",
		"distrito federal",
		" df ",
		"df/",
		"/df",
	})
}

func inferLocation(text string) string {
	normalized := normalizeText(text)
	switch {
	case isBrasilia(normalized):
		return "Brasilia/DF"
	case isRemote(normalized) && isBrazilOrLatam(normalized):
		return "Remote - Brazil/LATAM"
	case isBrazilOrLatam(normalized):
		return "Brazil"
	default:
		return ""
	}
}

func containsAny(text string, terms []string) bool {
	padded := " " + text + " "
	for _, term := range terms {
		if strings.Contains(padded, term) {
			return true
		}
	}
	return false
}

func normalizeText(text string) string {
	text = strings.ToLower(strings.TrimSpace(text))
	replacer := strings.NewReplacer(
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a",
		"\u00e9", "e", "\u00ea", "e",
		"\u00ed", "i",
		"\u00f3", "o", "\u00f4", "o", "\u00f5", "o",
		"\u00fa", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(text)
}

func stripHTML(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(input))

	inTag := false

	for _, char := range input {
		switch char {
		case '<':
			inTag = true
		case '>':
			if inTag {
				inTag = false
				builder.WriteRune(' ')
			}
		default:
			if !inTag {
				builder.WriteRune(char)
			}
		}
	}

	cleaned := html.UnescapeString(builder.String())
	cleaned = strings.ReplaceAll(cleaned, "\u00a0", " ")
	cleaned = strings.Join(strings.Fields(cleaned), " ")

	return cleaned
}

func cleanTags(tags []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		key := strings.ToLower(tag)
		if tag == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, tag)
	}
	return out
}

func dedupeJobs(jobs []Job) []Job {
	seen := map[string]bool{}
	var out []Job
	for _, job := range jobs {
		key := strings.ToLower(job.URL)
		if key == "" {
			key = strings.ToLower(job.Source + "|" + job.Title + "|" + job.Company)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, job)
	}
	return out
}

func writeJobs(path string, format string, jobs []Job) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	switch strings.ToLower(format) {
	case "json":
		encoder := json.NewEncoder(file)
		encoder.SetIndent("", "  ")
		return encoder.Encode(jobs)
	case "csv":
		writer := csv.NewWriter(file)
		defer writer.Flush()
		if err := writer.Write([]string{
			"source",
			"title",
			"description",
			"company",
			"company_logo",
			"location",
			"url",
			"tags",
			"posted_at",
			"salary_min",
			"salary_max",
			"salary_currency",
			"salary_period",
		}); err != nil {
			return err
		}
		for _, job := range jobs {
			if err := writer.Write([]string{
				job.Source,
				job.Title,
				job.Description,
				job.Company,
				job.CompanyLogo,
				job.Location,
				job.URL,
				strings.Join(job.Tags, "|"),
				job.PostedAt,
				formatFloat(job.SalaryMin),
				formatFloat(job.SalaryMax),
				job.SalaryCurrency,
				job.SalaryPeriod,
			}); err != nil {
				return err
			}
		}
		return writer.Error()
	default:
		return fmt.Errorf("unsupported format %q: use csv or json", format)
	}
}

func formatFloat(value float64) string {
	if value == 0 {
		return ""
	}
	return fmt.Sprintf("%.2f", value)
}
