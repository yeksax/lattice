package main

// client.go - the same binary doubles as the CLI. Commands talk to the
// running server; if it's down the CLI tries to auto-spawn it (see spawn.go),
// and `add`/`rm` fall back to writing the library directly when even that
// fails (a full rescan on the next daemon start reconciles).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func baseURL() string {
	return "http://" + listenAddr()
}

func apiClient() *http.Client { return &http.Client{Timeout: 5 * time.Second} }

// addViaServer registers a summary and returns its slug. Relative paths are
// resolved to absolute HERE, in the client - the daemon's cwd is not the
// user's, so a path resolved server-side would point at the wrong file (or
// nothing). viaServer reports whether the running daemon handled it or we
// fell back to a direct registration.
func addViaServer(path, title string, tags []string) (slug string, viaServer bool, err error) {
	if abs, aerr := filepath.Abs(path); aerr == nil {
		path = abs
	}
	body, _ := json.Marshal(map[string]any{"path": path, "title": title, "tags": tags})
	post := func() (*http.Response, error) {
		return apiClient().Post(baseURL()+"/api/summaries", "application/json", bytes.NewReader(body))
	}
	resp, err := post()
	if err != nil && ensureServer() == nil {
		resp, err = post() // daemon was down; spawned it - retry once
	}
	if err != nil {
		// Server down for good - register directly; the next start rescans.
		m, derr := addSummary(path, title, tags)
		if derr != nil {
			return "", false, derr
		}
		return m.Slug, false, nil
	}
	defer resp.Body.Close()
	var out struct {
		Slug  string `json:"slug"`
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode >= 300 {
		return "", true, fmt.Errorf("%s", out.Error)
	}
	return out.Slug, true, nil
}

func cliAdd(path, title string, tags []string, noOpen bool) error {
	slug, viaServer, err := addViaServer(path, title, tags)
	if err != nil {
		return err
	}
	if !viaServer {
		fmt.Printf("added %s (server not running - registered directly)\n", slug)
		return nil
	}
	url := baseURL() + "/s/" + slug
	fmt.Printf("added %s → %s\n", slug, url)
	if !noOpen {
		openInBrowser(url)
	}
	return nil
}

func cliLs() error {
	ensureServer() // best-effort spawn; the request error below reports failure
	resp, err := apiClient().Get(baseURL() + "/api/summaries")
	if err != nil {
		return fmt.Errorf("server not running at %s (start with: lattice serve)", baseURL())
	}
	defer resp.Body.Close()
	var docs []Doc
	if err := json.NewDecoder(resp.Body).Decode(&docs); err != nil {
		return err
	}
	if len(docs) == 0 {
		fmt.Println("no summaries yet - lattice add <file.html>")
		return nil
	}
	for _, d := range docs {
		flag := " "
		if d.Missing {
			flag = "!"
		}
		tags := ""
		if len(d.Tags) > 0 {
			tags = "  [" + strings.Join(d.Tags, ", ") + "]"
		}
		fmt.Printf("%s %-32s  %s  %s%s\n", flag, d.Slug, d.Created.Format("2006-01-02"), d.Title, tags)
	}
	return nil
}

func cliRm(slug string) error {
	del := func() (*http.Response, error) {
		req, _ := http.NewRequest(http.MethodDelete, baseURL()+"/api/summaries/"+slug, nil)
		return apiClient().Do(req)
	}
	resp, err := del()
	if err != nil && ensureServer() == nil {
		resp, err = del() // spawned the daemon - retry once
	}
	if err != nil {
		// Server down for good - remove directly.
		if derr := removeSummary(slug); derr != nil {
			return derr
		}
		fmt.Printf("removed %s (server not running - unregistered directly)\n", slug)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		return fmt.Errorf("%s", out.Error)
	}
	fmt.Printf("removed %s (original file untouched)\n", slug)
	return nil
}

// cliOpen opens the dashboard (no arg), a summary by slug, or - when the arg is
// a path to an existing file - adds that file (idempotently) and opens it. The
// last form is what makes `lattice open ./report.html` work from any directory.
func cliOpen(arg string) error {
	if err := ensureServer(); err != nil {
		return fmt.Errorf("server not running at %s: %w", baseURL(), err)
	}
	url := baseURL()
	if arg != "" {
		slug := arg
		if fi, err := os.Stat(arg); err == nil && !fi.IsDir() {
			s, _, aerr := addViaServer(arg, "", nil)
			if aerr != nil {
				return aerr
			}
			slug = s
		}
		url += "/s/" + slug
	}
	return openInBrowser(url)
}
