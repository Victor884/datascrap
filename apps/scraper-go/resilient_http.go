package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxCachedResponseSize = 12 << 20

var blockedDirectHosts = []string{
	"linkedin.com",
	"www.linkedin.com",
	"br.linkedin.com",
}

type transportStats struct {
	Requests       int
	CacheHits      int
	Retries        int
	RateLimited    int
	BlockedDirect  int
	CircuitStopped int
}

type resilientTransport struct {
	base        http.RoundTripper
	minInterval time.Duration
	maxRetries  int
	cacheDir    string
	cacheTTL    time.Duration

	mu          sync.Mutex
	nextRequest map[string]time.Time
	failures    map[string]int
	openUntil   map[string]time.Time
	stats       transportStats
}

type cachedHTTPResponse struct {
	StoredAt   time.Time   `json:"stored_at"`
	StatusCode int         `json:"status_code"`
	Header     http.Header `json:"header"`
	Body       []byte      `json:"body"`
}

func newResilientTransport(minInterval time.Duration, maxRetries int, cacheDir string, cacheTTL time.Duration) *resilientTransport {
	if minInterval < 0 {
		minInterval = 0
	}
	if maxRetries < 0 {
		maxRetries = 0
	}
	return &resilientTransport{
		base:        http.DefaultTransport,
		minInterval: minInterval,
		maxRetries:  maxRetries,
		cacheDir:    cacheDir,
		cacheTTL:    cacheTTL,
		nextRequest: map[string]time.Time{},
		failures:    map[string]int{},
		openUntil:   map[string]time.Time{},
	}
}

func (transport *resilientTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.Method != http.MethodGet {
		return transport.base.RoundTrip(request)
	}
	if isBlockedDirectHost(request.URL.Hostname()) {
		transport.addStat(func(stats *transportStats) { stats.BlockedDirect++ })
		return nil, fmt.Errorf("acesso direto automatizado a %s foi bloqueado; use uma API ou provedor de busca autorizado", request.URL.Hostname())
	}

	if response, ok := transport.cachedResponse(request); ok {
		transport.addStat(func(stats *transportStats) { stats.CacheHits++ })
		return response, nil
	}

	host := strings.ToLower(request.URL.Hostname())
	if until := transport.circuitOpenUntil(host); until.After(time.Now()) {
		transport.addStat(func(stats *transportStats) { stats.CircuitStopped++ })
		return nil, fmt.Errorf("circuit breaker de %s ativo ate %s", host, until.Format(time.RFC3339))
	}

	var lastErr error
	for attempt := 0; attempt <= transport.maxRetries; attempt++ {
		if err := transport.waitForHost(request.Context(), host); err != nil {
			return nil, err
		}
		transport.addStat(func(stats *transportStats) { stats.Requests++ })

		response, err := transport.base.RoundTrip(request.Clone(request.Context()))
		if err == nil && !shouldRetryStatus(response.StatusCode) {
			transport.recordResult(host, response.StatusCode)
			if isCacheableStatus(response.StatusCode) {
				return transport.cacheAndRestore(request, response)
			}
			return response, nil
		}

		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("servidor retornou %s", response.Status)
			transport.recordResult(host, response.StatusCode)
			if response.StatusCode == http.StatusTooManyRequests {
				transport.addStat(func(stats *transportStats) { stats.RateLimited++ })
			}
		}

		if attempt == transport.maxRetries {
			if response != nil {
				return response, nil
			}
			break
		}
		transport.addStat(func(stats *transportStats) { stats.Retries++ })
		delay := retryDelay(attempt, response)
		if response != nil {
			response.Body.Close()
		}
		if err := waitContext(request.Context(), delay); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func (transport *resilientTransport) waitForHost(ctx context.Context, host string) error {
	transport.mu.Lock()
	now := time.Now()
	readyAt := transport.nextRequest[host]
	if readyAt.Before(now) {
		readyAt = now
	}
	jitter := randomDuration(0, transport.minInterval/2)
	transport.nextRequest[host] = readyAt.Add(transport.minInterval + jitter)
	transport.mu.Unlock()
	return waitContext(ctx, time.Until(readyAt))
}

func (transport *resilientTransport) recordResult(host string, status int) {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if status == http.StatusForbidden || status == http.StatusTooManyRequests {
		transport.failures[host]++
		if transport.failures[host] >= 3 {
			transport.openUntil[host] = time.Now().Add(30 * time.Minute)
			transport.failures[host] = 0
		}
		return
	}
	if status >= 200 && status < 400 {
		transport.failures[host] = 0
		delete(transport.openUntil, host)
	}
}

func (transport *resilientTransport) circuitOpenUntil(host string) time.Time {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	return transport.openUntil[host]
}

func (transport *resilientTransport) addStat(update func(*transportStats)) {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	update(&transport.stats)
}

func (transport *resilientTransport) Stats() transportStats {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	return transport.stats
}

func (transport *resilientTransport) cachedResponse(request *http.Request) (*http.Response, bool) {
	if transport.cacheTTL <= 0 || strings.TrimSpace(transport.cacheDir) == "" {
		return nil, false
	}
	payload, err := os.ReadFile(transport.cachePath(request.URL))
	if err != nil {
		return nil, false
	}
	var cached cachedHTTPResponse
	if json.Unmarshal(payload, &cached) != nil || time.Since(cached.StoredAt) > transport.cacheTTL {
		return nil, false
	}
	return responseFromCache(request, cached), true
}

func (transport *resilientTransport) cacheAndRestore(request *http.Request, response *http.Response) (*http.Response, error) {
	if transport.cacheTTL <= 0 || strings.TrimSpace(transport.cacheDir) == "" {
		return response, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxCachedResponseSize+1))
	response.Body.Close()
	if err != nil {
		return nil, err
	}
	if len(body) > maxCachedResponseSize {
		return nil, errors.New("resposta excedeu o limite seguro de 12 MB")
	}
	cached := cachedHTTPResponse{
		StoredAt:   time.Now().UTC(),
		StatusCode: response.StatusCode,
		Header:     response.Header.Clone(),
		Body:       body,
	}
	if payload, err := json.Marshal(cached); err == nil {
		path := transport.cachePath(request.URL)
		if os.MkdirAll(filepath.Dir(path), 0o755) == nil {
			temporary := path + ".tmp"
			if os.WriteFile(temporary, payload, 0o600) == nil {
				_ = os.Rename(temporary, path)
			}
		}
	}
	return responseFromCache(request, cached), nil
}

func (transport *resilientTransport) cachePath(target *url.URL) string {
	sum := sha256.Sum256([]byte(target.String()))
	return filepath.Join(transport.cacheDir, hex.EncodeToString(sum[:])+".json")
}

func responseFromCache(request *http.Request, cached cachedHTTPResponse) *http.Response {
	return &http.Response{
		StatusCode:    cached.StatusCode,
		Status:        fmt.Sprintf("%d %s", cached.StatusCode, http.StatusText(cached.StatusCode)),
		Header:        cached.Header.Clone(),
		Body:          io.NopCloser(bytes.NewReader(cached.Body)),
		ContentLength: int64(len(cached.Body)),
		Request:       request,
	}
}

func isBlockedDirectHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	for _, blocked := range blockedDirectHosts {
		if host == blocked || strings.HasSuffix(host, "."+blocked) {
			return true
		}
	}
	return false
}

func shouldRetryStatus(status int) bool {
	return status == http.StatusTooManyRequests || status == http.StatusRequestTimeout || status >= 500
}

func isCacheableStatus(status int) bool {
	return status >= 200 && status < 300 || status == http.StatusNotFound || status == http.StatusGone
}

func retryDelay(attempt int, response *http.Response) time.Duration {
	if response != nil {
		if delay, ok := parseRetryAfter(response.Header.Get("Retry-After")); ok {
			return delay
		}
	}
	base := time.Second * time.Duration(1<<min(attempt, 5))
	return base + randomDuration(0, base)
}

func parseRetryAfter(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second, true
	}
	when, err := http.ParseTime(value)
	if err != nil {
		return 0, false
	}
	return max(0, time.Until(when)), true
}

func randomDuration(minimum, maximum time.Duration) time.Duration {
	if maximum <= minimum {
		return minimum
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(maximum-minimum)+1))
	if err != nil {
		return minimum
	}
	return minimum + time.Duration(value.Int64())
}

func waitContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
