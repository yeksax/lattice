package main

// hosted.go - the CLI side of the paid share backend (cloud/). `lattice share`
// defaults to hosted once you're logged in (the snapshot lives on Cloudflare
// and stays up with your laptop closed); `--local` keeps the expose/cloudflared
// path in share.go. login/unshare/results/shares get hosted variants that the
// dispatchers in client.go route to based on config.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// --- config access from the CLI ----------------------------------------------
//
// The daemon owns the config file, so we go through its API when it's up (and
// fall back to a direct read/write when it isn't - the file is the same).

func loadConfigClient() Config {
	resp, err := apiClient().Get(baseURL() + "/api/config")
	if err != nil {
		return loadConfig()
	}
	defer resp.Body.Close()
	var c Config
	if json.NewDecoder(resp.Body).Decode(&c) != nil {
		return loadConfig()
	}
	return c
}

func saveConfigClient(c Config) error {
	body, _ := json.Marshal(c)
	req, _ := http.NewRequest(http.MethodPut, baseURL()+"/api/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := apiClient().Do(req)
	if err != nil {
		return saveConfig(c) // daemon down - write the file directly
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("saving config: HTTP %d", resp.StatusCode)
	}
	return nil
}

// cliLogin stores the hosted token (and optional API base override) in config.
func cliLogin(token, api string) error {
	c := loadConfigClient()
	c.Hosted.Token = token
	if api != "" {
		c.Hosted.APIBase = api
	}
	if c.Hosted.DefaultTarget == "" {
		c.Hosted.DefaultTarget = "hosted"
	}
	if err := saveConfigClient(c); err != nil {
		return err
	}
	fmt.Printf("logged in - hosted shares via %s\n", c.resolvedAPIBase())
	fmt.Println("`lattice share <slug>` now defaults to hosted; use --local for expose")
	return nil
}

func cliLogout() error {
	c := loadConfigClient()
	c.Hosted.Token = ""
	if err := saveConfigClient(c); err != nil {
		return err
	}
	fmt.Println("logged out - `lattice share` reverts to local expose")
	return nil
}

// --- hosted share operations -------------------------------------------------

// hostedAPI issues an authenticated request to the Worker and decodes JSON.
func hostedAPI(c Config, method, path string, body any) (*http.Response, error) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.resolvedAPIBase()+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Hosted.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return apiClient().Do(req)
}

// rawSummaryHTML returns the pristine snapshot bytes for a slug. Prefers the
// daemon's ?raw=1 (resolves the symlink target), falling back to reading the
// link directly when the server is down.
func rawSummaryHTML(slug string) ([]byte, error) {
	resp, err := apiClient().Get(baseURL() + "/s/" + slug + "?raw=1")
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode < 300 {
			return io.ReadAll(resp.Body)
		}
	}
	b, ferr := os.ReadFile(filepath.Join(summariesDir(), slug+".html"))
	if ferr != nil {
		return nil, fmt.Errorf("summary not found: %s", slug)
	}
	return b, nil
}

func hostedShare(slug string, random bool) error {
	c := loadConfigClient()
	if c.Hosted.Token == "" {
		return fmt.Errorf("not logged in - run: lattice login <token>")
	}
	html, err := rawSummaryHTML(slug)
	if err != nil {
		return err
	}
	resp, err := hostedAPI(c, http.MethodPost, "/v1/shares", map[string]any{
		"slug":   slug,
		"html":   string(html),
		"random": random,
	})
	if err != nil {
		return fmt.Errorf("hosted API unreachable at %s: %w", c.resolvedAPIBase(), err)
	}
	defer resp.Body.Close()
	var out struct {
		URL   string `json:"url"`
		Sub   string `json:"sub"`
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s", out.Error)
	}
	fmt.Printf("shared %s (hosted) → %s\n", slug, hostedDisplayURL(c, out.URL))
	fmt.Println("stays online with your laptop closed; re-run to update, unshare to stop")
	return nil
}

func hostedUnshare(slug string) error {
	c := loadConfigClient()
	resp, err := hostedAPI(c, http.MethodDelete, "/v1/shares/"+slug, nil)
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		return fmt.Errorf("%s", out.Error)
	}
	fmt.Printf("unshared %s (hosted; poll data kept)\n", slug)
	return nil
}

func hostedSharesList() error {
	c := loadConfigClient()
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares", nil)
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	var shares []struct {
		Slug  string `json:"slug"`
		URL   string `json:"url"`
		Votes int    `json:"votes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&shares); err != nil {
		return err
	}
	if len(shares) == 0 {
		fmt.Println("no active hosted shares - lattice share <slug>")
		return nil
	}
	for _, sh := range shares {
		fmt.Printf("%-32s  %-40s  %d vote(s)\n", sh.Slug, hostedDisplayURL(c, sh.URL), sh.Votes)
	}
	return nil
}

func hostedResults(slug string) error {
	c := loadConfigClient()
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+slug+"/results", nil)
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		return fmt.Errorf("%s", out.Error)
	}
	var out struct {
		Submissions []json.RawMessage `json:"submissions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return err
	}
	if len(out.Submissions) == 0 {
		fmt.Println("no submissions yet")
		return nil
	}
	for _, s := range out.Submissions {
		fmt.Println(string(s))
	}
	fmt.Printf("- %d submission(s)\n", len(out.Submissions))
	return nil
}

// useHosted decides whether a share-family command targets the hosted backend.
// Explicit flags win; otherwise it follows config (logged in and not pinned
// local). --local and --hosted together is treated as --hosted.
func useHosted(hosted, local bool) bool {
	if hosted {
		return true
	}
	if local {
		return false
	}
	return loadConfigClient().wantsHosted()
}

// hostedDisplayURL makes a dev URL (path-only, e.g. /s/abc) absolute against
// the API base so the printed link is clickable; prod URLs are already absolute.
func hostedDisplayURL(c Config, u string) string {
	if len(u) > 0 && u[0] == '/' {
		return c.resolvedAPIBase() + u
	}
	return u
}
