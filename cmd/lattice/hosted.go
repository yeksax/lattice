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
	"net/url"
	"os"
	"strings"
)

var errNotLoggedIn = errors.New("not logged in - run: lattice login <token>")

// errNoHistoryAPI marks a backend older than the snapshot-history endpoints.
// A self-hosted Worker can lag the CLI, and "method not allowed" is not an
// answer anyone can act on.
var errNoHistoryAPI = errors.New("this backend has no snapshot history API yet - deploy the current Worker")

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

// hostedShareRow mirrors one row of the hosted listing. Everything past URL and
// Votes is what the dashboard's shared view puts in front of the owner without
// making them open the share; a backend that predates a field just sends zero,
// and the dashboard omits that line.
type hostedShareRow struct {
	Slug        string   `json:"slug"`
	Sub         string   `json:"sub,omitempty"`
	Title       string   `json:"title,omitempty"`
	URL         string   `json:"url"`
	Created     int64    `json:"created,omitempty"`
	Updated     int64    `json:"updated,omitempty"`
	Version     int      `json:"version,omitempty"`
	Votes       int      `json:"votes"`
	Threads     int      `json:"threads,omitempty"`
	ThreadsOpen int      `json:"threads_open,omitempty"`
	Comments    int      `json:"comments,omitempty"`
	Domains     []string `json:"domains"`
}

// hostedCommentRow and hostedThread are both the wire shape of the backend's
// listing and what the daemon hands the browser for a hosted-born row, so the
// merged answer in sync.go needs no third representation. Signature is the
// dedupe key: set when this row is the backend's copy of something written
// locally, empty when the row was born on the hosted side.
type hostedCommentRow struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Body      string `json:"body"`
	Created   int64  `json:"created"`
	Updated   int64  `json:"updated,omitempty"`
	Provider  string `json:"author_provider,omitempty"`
	Signature string `json:"signature,omitempty"`
	Edited    bool   `json:"edited,omitempty"`
	Deleted   bool   `json:"deleted,omitempty"`
	CanEdit   bool   `json:"can_edit,omitempty"`

	Reactions []hostedReaction `json:"reactions,omitempty"`
}

type hostedReaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

type hostedThread struct {
	ID                     string             `json:"id"`
	Selector               string             `json:"selector"`
	AnchorText             string             `json:"anchor_text"`
	SnapshotVersionCreated int                `json:"snapshot_version_created"`
	Status                 string             `json:"status"`
	Signature              string             `json:"signature,omitempty"`
	Created                int64              `json:"created,omitempty"`
	Updated                int64              `json:"updated,omitempty"`
	Comments               []hostedCommentRow `json:"comments"`
}

// hostedCreate uploads a snapshot and returns its public URL. Re-creating an
// existing share replaces the snapshot (that's how updates work).
func hostedCreate(c Config, slug string, html []byte, random bool, domains []string) (string, error) {
	if c.Hosted.Token == "" {
		return "", errNotLoggedIn
	}
	payload := map[string]any{
		"slug":   slug,
		"html":   string(html),
		"random": random,
	}
	if domains != nil {
		payload["allowed_domains"] = domains
	}
	resp, err := hostedAPI(c, http.MethodPost, "/v1/shares", payload)
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

type hostedVersion struct {
	Version int   `json:"version"`
	Created int64 `json:"created"`
	Size    int64 `json:"size"`
	Current bool  `json:"current"`
}

// hostedVersions lists a share's snapshot revisions, newest first.
func hostedVersions(c Config, slug string) ([]hostedVersion, error) {
	if c.Hosted.Token == "" {
		return nil, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+slug+"/versions", nil)
	if err != nil {
		return nil, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	// A backend without these routes falls through to its slug handler, which
	// answers 405 for a GET. A 404 here is a real "not shared" and keeps its
	// own message.
	if resp.StatusCode == http.StatusMethodNotAllowed {
		return nil, errNoHistoryAPI
	}
	var out struct {
		Versions []hostedVersion `json:"versions"`
		Error    string          `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		if out.Error == "" {
			out.Error = resp.Status
		}
		return nil, errors.New(out.Error)
	}
	return out.Versions, nil
}

// hostedVersionHTML fetches one past revision's bytes so the dashboard can
// frame it locally instead of sending the reader to the hosted origin.
func hostedVersionHTML(c Config, slug string, version int) ([]byte, error) {
	if c.Hosted.Token == "" {
		return nil, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, fmt.Sprintf("/v1/shares/%s/versions/%d", slug, version), nil)
	if err != nil {
		return nil, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.Unmarshal(body, &out)
		if out.Error == "" {
			out.Error = resp.Status
		}
		return nil, errors.New(out.Error)
	}
	return body, nil
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

func hostedThreads(c Config, slug string) ([]hostedThread, error) {
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+slug+"/threads", nil)
	if err != nil {
		return nil, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		Threads []hostedThread `json:"threads"`
		Error   string         `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		if out.Error == "" {
			out.Error = resp.Status
		}
		return nil, errors.New(out.Error)
	}
	return out.Threads, nil
}

// hostedThreadCall issues one owner-side discussion request and decodes the
// backend's answer into out (which may be nil). It is the write half of the
// double write: everything the daemon stores locally for a shared summary comes
// back through here carrying the ids the backend assigned.
func hostedThreadCall(c Config, method, slug, path string, body, out any) error {
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
	resp, err := hostedAPI(c, method, "/v1/shares/"+url.PathEscape(slug)+path, body)
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var fail struct {
			Error string `json:"error"`
		}
		json.Unmarshal(raw, &fail)
		if fail.Error == "" {
			fail.Error = resp.Status
		}
		return errors.New(fail.Error)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// hostedPushThread sends a locally written thread up, stamped with the ids this
// machine minted. Re-sending one is safe: the backend answers with the row it
// already holds instead of creating a second one.
func hostedPushThread(c Config, slug string, thread *localThread, first *localComment) (threadID, commentID string, err error) {
	var out struct {
		ID        string `json:"id"`
		CommentID string `json:"comment_id"`
	}
	err = hostedThreadCall(c, http.MethodPost, slug, "/threads", map[string]string{
		"selector":          thread.Selector,
		"anchor_text":       thread.AnchorText,
		"body":              first.Body,
		"signature":         thread.ID,
		"comment_signature": first.ID,
	}, &out)
	return out.ID, out.CommentID, err
}

func hostedPushComment(c Config, slug, hostedThreadID string, comment *localComment) (string, error) {
	var out struct {
		ID string `json:"id"`
	}
	err := hostedThreadCall(c, http.MethodPost, slug,
		"/threads/"+url.PathEscape(hostedThreadID)+"/comments",
		map[string]string{"body": comment.Body, "signature": comment.ID}, &out)
	return out.ID, err
}

func hostedEditComment(c Config, slug, threadID, commentID, body string) error {
	return hostedThreadCall(c, http.MethodPatch, slug,
		"/threads/"+url.PathEscape(threadID)+"/comments/"+url.PathEscape(commentID),
		map[string]string{"body": body}, nil)
}

func hostedDeleteComment(c Config, slug, threadID, commentID string) error {
	return hostedThreadCall(c, http.MethodDelete, slug,
		"/threads/"+url.PathEscape(threadID)+"/comments/"+url.PathEscape(commentID), nil, nil)
}

func hostedToggleReaction(c Config, slug, threadID, commentID, emoji string) error {
	return hostedThreadCall(c, http.MethodPost, slug,
		"/threads/"+url.PathEscape(threadID)+"/comments/"+url.PathEscape(commentID)+"/reactions",
		map[string]string{"emoji": emoji}, nil)
}

func hostedDropThread(c Config, slug, threadID string) error {
	return hostedThreadCall(c, http.MethodDelete, slug, "/threads/"+url.PathEscape(threadID), nil, nil)
}

func hostedSetThreadStatus(c Config, slug, threadID, action string) error {
	return hostedThreadCall(c, http.MethodPost, slug,
		"/threads/"+url.PathEscape(threadID)+"/"+action, nil, nil)
}

func hostedThreadMutation(c Config, slug, path string, body any) error {
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodPost, "/v1/shares/"+slug+path, body)
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var out struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		if out.Error == "" {
			out.Error = resp.Status
		}
		return errors.New(out.Error)
	}
	return nil
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

func hostedShare(slug string, random bool, domains []string) error {
	c := loadConfigClient()
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
	html, err := rawSummaryHTML(slug)
	if err != nil {
		return err
	}
	url, err := hostedCreate(c, slug, html, random, domains)
	if err != nil {
		return err
	}
	fmt.Printf("shared %s → %s\n", slug, url)
	if len(domains) > 0 {
		fmt.Printf("access restricted to %s via Google\n", strings.Join(domains, ", "))
	} else if domains != nil {
		fmt.Println("access changed to public-by-URL")
	}
	fmt.Println("stays online with your laptop closed; re-run to update, unshare to stop")
	return nil
}

func hostedThreadsList(slug string, onlyOpen, rawJSON bool) error {
	threads, err := hostedThreads(loadConfigClient(), slug)
	if err != nil {
		return err
	}
	if rawJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(threads)
	}
	shown := 0
	for _, thread := range threads {
		if onlyOpen && thread.Status != "open" {
			continue
		}
		shown++
		fmt.Printf("%s  %s  %s  snapshot v%d\n", thread.ID, thread.Status, thread.Selector, thread.SnapshotVersionCreated)
		for _, comment := range thread.Comments {
			fmt.Printf("  %s: %s\n", comment.Author, comment.Body)
		}
	}
	if shown == 0 {
		fmt.Println("no threads")
	}
	return nil
}

func hostedCreateThread(slug, selector, message string) error {
	return hostedThreadMutation(loadConfigClient(), slug, "/threads", map[string]string{
		"selector": selector,
		"body":     message,
	})
}

func hostedReply(slug, threadID, message string) error {
	return hostedThreadMutation(
		loadConfigClient(),
		slug,
		"/threads/"+threadID+"/comments",
		map[string]string{"body": message},
	)
}

func hostedThreadStatus(slug, threadID, action string) error {
	if err := hostedThreadMutation(loadConfigClient(), slug, "/threads/"+threadID+"/"+action, nil); err != nil {
		return err
	}
	past := map[string]string{"resolve": "resolved", "reopen": "reopened"}[action]
	fmt.Printf("%s %s\n", past, threadID)
	return nil
}

func hostedUnshare(slug string) error {
	if err := hostedDelete(loadConfigClient(), slug); err != nil {
		return err
	}
	fmt.Printf("unshared %s (poll data kept; snapshots and discussions removed)\n", slug)
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
		access := "public-by-URL"
		if len(sh.Domains) > 0 {
			access = "@" + strings.Join(sh.Domains, ", @")
		}
		fmt.Printf("%-32s  %-40s  %d vote(s)  %s\n", sh.Slug, sh.URL, sh.Votes, access)
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
