package main

// hosted.go - client for the hosted share backend (cloud/). All public sharing
// goes through the hosted service (lattice.pub): `lattice share` uploads a
// snapshot that stays up with your laptop closed, and the daemon proxies the
// dashboard's /api/shares endpoints to the same API. Requires `lattice login`.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
)

var errNotLoggedIn = errors.New("not logged in - run: lattice login <token>")

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
	if err := validateConfig(c); err != nil {
		return err
	}
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
	if err := saveConfigClient(c); err != nil {
		return err
	}
	fmt.Printf("logged in - shares publish via %s\n", c.resolvedAPIBase())
	return nil
}

func cliLogout() error {
	c := loadConfigClient()
	c.Hosted.Token = ""
	if err := saveConfigClient(c); err != nil {
		return err
	}
	fmt.Println("logged out - sharing disabled until you log in again")
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

type hostedShareRow struct {
	Slug  string `json:"slug"`
	URL   string `json:"url"`
	Votes int    `json:"votes"`
}

// hostedCreate uploads a snapshot and returns its public URL. Re-creating an
// existing share replaces the snapshot (that's how updates work).
func hostedCreate(c Config, slug string, html []byte, random bool) (string, error) {
	if c.Hosted.Token == "" {
		return "", errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodPost, "/v1/shares", map[string]any{
		"slug":   slug,
		"html":   string(html),
		"random": random,
	})
	if err != nil {
		return "", fmt.Errorf("hosted API unreachable at %s: %w", c.resolvedAPIBase(), err)
	}
	defer resp.Body.Close()
	var out struct {
		URL   string `json:"url"`
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("%s", out.Error)
	}
	return hostedDisplayURL(c, out.URL), nil
}

func hostedDelete(c Config, slug string) error {
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
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
	return nil
}

func hostedList(c Config) ([]hostedShareRow, error) {
	if c.Hosted.Token == "" {
		return nil, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares", nil)
	if err != nil {
		return nil, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	var shares []hostedShareRow
	if err := json.NewDecoder(resp.Body).Decode(&shares); err != nil {
		return nil, err
	}
	for i := range shares {
		shares[i].URL = hostedDisplayURL(c, shares[i].URL)
	}
	return shares, nil
}

func hostedSubmissions(c Config, slug string) ([]json.RawMessage, error) {
	if c.Hosted.Token == "" {
		return nil, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+slug+"/results", nil)
	if err != nil {
		return nil, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		return nil, fmt.Errorf("%s", out.Error)
	}
	var out struct {
		Submissions []json.RawMessage `json:"submissions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Submissions, nil
}

// --- CLI wrappers -------------------------------------------------------------

// rawSummaryHTML returns the pristine snapshot bytes for a slug. Prefers the
// daemon's ?raw=1 (resolves the registered source), falling back to resolving
// and reading the source directly when the server is down.
func rawSummaryHTML(slug string) ([]byte, error) {
	resp, err := apiClient().Get(baseURL() + "/s/" + slug + "?raw=1")
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode < 300 {
			return io.ReadAll(resp.Body)
		}
	}
	b, ferr := os.ReadFile(resolveSource(slug))
	if ferr != nil {
		return nil, fmt.Errorf("summary not found: %s", slug)
	}
	return b, nil
}

func hostedShare(slug string, random bool) error {
	c := loadConfigClient()
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
	html, err := rawSummaryHTML(slug)
	if err != nil {
		return err
	}
	url, err := hostedCreate(c, slug, html, random)
	if err != nil {
		return err
	}
	fmt.Printf("shared %s → %s\n", slug, url)
	fmt.Println("stays online with your laptop closed; re-run to update, unshare to stop")
	return nil
}

func hostedUnshare(slug string) error {
	if err := hostedDelete(loadConfigClient(), slug); err != nil {
		return err
	}
	fmt.Printf("unshared %s (poll data kept)\n", slug)
	return nil
}

func hostedSharesList() error {
	shares, err := hostedList(loadConfigClient())
	if err != nil {
		return err
	}
	if len(shares) == 0 {
		fmt.Println("no active shares - lattice share <slug>")
		return nil
	}
	for _, sh := range shares {
		fmt.Printf("%-32s  %-40s  %d vote(s)\n", sh.Slug, sh.URL, sh.Votes)
	}
	return nil
}

func hostedResults(slug string) error {
	subs, err := hostedSubmissions(loadConfigClient(), slug)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		fmt.Println("no submissions yet")
		return nil
	}
	for _, s := range subs {
		fmt.Println(string(s))
	}
	fmt.Printf("- %d submission(s)\n", len(subs))
	return nil
}

// hostedDisplayURL makes a dev URL (path-only, e.g. /s/abc) absolute against
// the API base so the printed link is clickable; prod URLs are already absolute.
func hostedDisplayURL(c Config, u string) string {
	if len(u) > 0 && u[0] == '/' {
		return c.resolvedAPIBase() + u
	}
	return u
}
