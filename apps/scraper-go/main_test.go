package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSplitCommaList(t *testing.T) {
	got := splitCommaList(" LinkedIn,indeed,linkedin, jobicy ")
	want := []string{"linkedin", "indeed", "jobicy"}
	if len(got) != len(want) {
		t.Fatalf("splitCommaList() = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("splitCommaList() = %v, want %v", got, want)
		}
	}
}

func TestBuildPublicSources(t *testing.T) {
	sources, err := buildSources("public")
	if err != nil {
		t.Fatalf("buildSources(public) returned error: %v", err)
	}
	if len(sources) != len(publicSourceNames) {
		t.Fatalf("buildSources(public) returned %d sources, want %d", len(sources), len(publicSourceNames))
	}
}

func TestCredentialSourceRequiresKey(t *testing.T) {
	t.Setenv("SERPAPI_KEY", "")
	if _, err := buildSources("linkedin"); err == nil {
		t.Fatal("buildSources(linkedin) should require SERPAPI_KEY")
	}
}

func TestRoleFilterRejectsUnrelatedTechnologyJob(t *testing.T) {
	query := "engenheiro de dados junior,analista de dados junior,desenvolvedor python,python,sql"
	unrelated := Job{Title: "Senior SecOps Automation Engineer", Location: "Remote - Brazil", Tags: []string{"Python", "SQL"}}
	if matchesTargetJob(unrelated, query) {
		t.Fatal("role filter accepted an unrelated job based only on technology keywords")
	}

	target := Job{Title: "Junior Data Engineer", Location: "Remote - Brazil", Tags: []string{"Python", "SQL"}}
	if !matchesTargetJob(target, query) {
		t.Fatal("role filter rejected a target data job")
	}
}

func TestLocationRejectsRemoteEurope(t *testing.T) {
	job := Job{Title: "Data Engineer", Location: "Remote - Europe"}
	description := "Our global company also has customers in Brazil and LATAM."
	if matchesTargetJobWithExtra(job, "data engineer", description) {
		t.Fatal("location filter accepted a Europe-only remote job based on description text")
	}
}

func TestAPIRequestUsesTransparentHeaders(t *testing.T) {
	req, err := newAPIRequest(context.Background(), "https://example.com/jobs")
	if err != nil {
		t.Fatalf("newAPIRequest returned error: %v", err)
	}
	if got := req.Header.Get("User-Agent"); got != "DataScrap/0.2 (+https://github.com/Victor884)" {
		t.Fatalf("unexpected User-Agent: %q", got)
	}
	if req.Header.Get("Accept") == "" || req.Header.Get("Accept-Language") == "" {
		t.Fatal("expected Accept and Accept-Language headers")
	}
}

func TestResilientTransportUsesCache(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"jobs":[{"title":"Data Engineer"}]}`)
	}))
	defer server.Close()

	transport := newResilientTransport(0, 0, t.TempDir(), time.Hour)
	client := &http.Client{Transport: transport}
	for range 2 {
		response, err := client.Get(server.URL + "/jobs?q=data")
		if err != nil {
			t.Fatalf("client.Get returned error: %v", err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}

	if got := requests.Load(); got != 1 {
		t.Fatalf("server received %d requests, want 1", got)
	}
	if got := transport.Stats().CacheHits; got != 1 {
		t.Fatalf("cache hits = %d, want 1", got)
	}
}

func TestResilientTransportRetriesTemporaryFailure(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if requests.Add(1) == 1 {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(writer, "ok")
	}))
	defer server.Close()

	transport := newResilientTransport(0, 1, "", 0)
	client := &http.Client{Transport: transport}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("client.Get returned error: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if got := transport.Stats().Retries; got != 1 {
		t.Fatalf("retries = %d, want 1", got)
	}
}

func TestResilientTransportBlocksDirectLinkedIn(t *testing.T) {
	transport := newResilientTransport(0, 0, "", 0)
	request, err := http.NewRequest(http.MethodGet, "https://www.linkedin.com/jobs/search", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = transport.RoundTrip(request)
	if err == nil || !strings.Contains(err.Error(), "acesso direto automatizado") {
		t.Fatalf("expected preventive block, got %v", err)
	}
	if got := transport.Stats().BlockedDirect; got != 1 {
		t.Fatalf("blocked direct = %d, want 1", got)
	}
}
