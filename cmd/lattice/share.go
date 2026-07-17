package main

// share.go - public sharing over Cloudflare tunnels (via the `expose` CLI)
// with poll collection. Isolation is structural, not filtered: every share
// runs its OWN listener on a dedicated localhost port that can serve exactly
// one summary and accept votes for it. The tunnel points at that port, so the
// dashboard, the API and every other summary are unreachable from outside by
// construction.
//
// Poll storage is an append-only JSONL per slug under .lattice/polls/ - the
// filesystem-is-the-database rule applies to votes too.

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Share struct {
	Slug    string    `json:"slug"`
	Sub     string    `json:"sub"`
	Port    int       `json:"port"`
	Created time.Time `json:"created"`
}

func (sh *Share) URL() string { return "https://" + sh.Sub + ".yeksax.dev" }

func sharesFile() string          { return filepath.Join(summariesDir(), ".lattice", "shares.json") }
func pollsDir() string            { return filepath.Join(summariesDir(), ".lattice", "polls") }
func pollFile(slug string) string { return filepath.Join(pollsDir(), slug+".jsonl") }

type shareManager struct {
	mu        sync.Mutex
	shares    map[string]*Share // by slug
	listeners map[string]*http.Server
	pollJS    string
}

func newShareManager(pollJS string) *shareManager {
	return &shareManager{
		shares:    map[string]*Share{},
		listeners: map[string]*http.Server{},
		pollJS:    pollJS,
	}
}

// load restores shares from disk and re-binds their listeners. The expose
// cloudflared daemons are detached and survive lattice restarts; re-running
// expose with the same sub+port is a no-op, so a normal restart re-attaches.
func (sm *shareManager) load() {
	b, err := os.ReadFile(sharesFile())
	if err != nil {
		return
	}
	var shares []*Share
	if json.Unmarshal(b, &shares) != nil {
		return
	}
	for _, sh := range shares {
		if err := sm.bind(sh); err != nil {
			log.Printf("share %s: rebind failed: %v", sh.Slug, err)
			continue
		}
		sm.shares[sh.Slug] = sh
	}
	if len(sm.shares) > 0 {
		log.Printf("restored %d share(s)", len(sm.shares))
	}
}

func (sm *shareManager) save() {
	out := make([]*Share, 0, len(sm.shares))
	for _, sh := range sm.shares {
		out = append(out, sh)
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	os.WriteFile(sharesFile(), b, 0o644)
}

// bind starts the isolated listener for a share, re-provisioning the tunnel
// if the recorded port is no longer available.
func (sm *shareManager) bind(sh *Share) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", sh.Port))
	if err != nil {
		// Port taken - move the share to a fresh port and re-point the tunnel.
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return err
		}
		sh.Port = ln.Addr().(*net.TCPAddr).Port
		exposeCmd("stop", sh.Sub) // old mapping, best-effort
		if _, err := exposeCmd(fmt.Sprint(sh.Port), sh.Sub); err != nil {
			ln.Close()
			return err
		}
	} else {
		// Re-attach (no-op if the cloudflared daemon is still up).
		if _, err := exposeCmd(fmt.Sprint(sh.Port), sh.Sub); err != nil {
			log.Printf("share %s: expose re-attach: %v", sh.Slug, err)
		}
	}
	srv := &http.Server{Handler: sm.publicHandler(sh.Slug)}
	sm.listeners[sh.Slug] = srv
	go srv.Serve(ln)
	return nil
}

// create shares a summary. Idempotent: sharing an already-shared slug returns
// the existing share.
func (sm *shareManager) create(slug string, random bool) (*Share, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sh, ok := sm.shares[slug]; ok {
		return sh, nil
	}
	if _, err := os.Stat(filepath.Join(summariesDir(), slug+".html")); err != nil {
		return nil, fmt.Errorf("summary not found (or target missing): %s", slug)
	}

	sub := slug
	if random || !validSub(sub) {
		sub = randSub()
	}
	for s := range sm.shares {
		if sm.shares[s].Sub == sub {
			sub = randSub() // slug collision across shares - fall back
			break
		}
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	sh := &Share{Slug: slug, Sub: sub, Port: ln.Addr().(*net.TCPAddr).Port, Created: time.Now()}
	if out, err := exposeCmd(fmt.Sprint(sh.Port), sh.Sub); err != nil {
		ln.Close()
		return nil, fmt.Errorf("expose failed: %v - %s", err, strings.TrimSpace(out))
	}

	srv := &http.Server{Handler: sm.publicHandler(slug)}
	sm.listeners[slug] = srv
	go srv.Serve(ln)

	sm.shares[slug] = sh
	sm.save()
	log.Printf("shared %s → %s (port %d)", slug, sh.URL(), sh.Port)
	return sh, nil
}

// remove stops the tunnel and the listener. Poll data is kept.
func (sm *shareManager) remove(slug string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sh, ok := sm.shares[slug]
	if !ok {
		return fmt.Errorf("not shared: %s", slug)
	}
	if out, err := exposeCmd("stop", sh.Sub); err != nil {
		log.Printf("expose stop %s: %v - %s", sh.Sub, err, strings.TrimSpace(out))
	}
	if srv := sm.listeners[slug]; srv != nil {
		srv.Close()
		delete(sm.listeners, slug)
	}
	delete(sm.shares, slug)
	sm.save()
	return nil
}

func (sm *shareManager) list() []*Share {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	out := make([]*Share, 0, len(sm.shares))
	for _, sh := range sm.shares {
		out = append(out, sh)
	}
	return out
}

func (sm *shareManager) get(slug string) *Share {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.shares[slug]
}

// publicHandler is everything the outside world can reach - one summary
// (poll bridge injected, no hot-reload client) and its vote endpoint.
func (sm *shareManager) publicHandler(slug string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		b, err := os.ReadFile(filepath.Join(summariesDir(), slug+".html"))
		if err != nil {
			http.Error(w, "gone", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(injectScript(b, `<script id="lattice-poll" data-endpoint="/submit" data-results="/results">`+sm.pollJS+`</script>`))
	})
	mux.HandleFunc("POST /submit", func(w http.ResponseWriter, r *http.Request) {
		recordSubmission(w, r, slug, "share")
	})
	// Aggregate counts only - never IP/UA/voter - so a public poll can show its
	// own live results without leaking who voted.
	mux.HandleFunc("GET /results", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, aggregate(slug))
	})
	return mux
}

// recordSubmission appends one vote line. Shared with the localhost endpoint
// so the user's own vote at /s/{slug} lands in the same file.
var pollMu sync.Mutex

func recordSubmission(w http.ResponseWriter, r *http.Request, slug, via string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil || !json.Valid(body) {
		httpErr(w, http.StatusBadRequest, "body must be JSON ≤ 64KB")
		return
	}
	ip := r.Header.Get("CF-Connecting-IP")
	if ip == "" {
		ip = r.RemoteAddr
	}
	line, _ := json.Marshal(map[string]any{
		"t":    time.Now().Format(time.RFC3339),
		"via":  via,
		"ip":   ip,
		"ua":   r.UserAgent(),
		"data": json.RawMessage(body),
	})

	pollMu.Lock()
	defer pollMu.Unlock()
	if err := os.MkdirAll(pollsDir(), 0o755); err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	f, err := os.OpenFile(pollFile(slug), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close()
	f.Write(append(line, '\n'))
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(`{"ok":true}`))
}

func readSubmissions(slug string) []json.RawMessage {
	f, err := os.Open(pollFile(slug))
	if err != nil {
		return []json.RawMessage{}
	}
	defer f.Close()
	out := []json.RawMessage{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 128<<10)
	for sc.Scan() {
		if line := strings.TrimSpace(sc.Text()); line != "" {
			out = append(out, json.RawMessage(line))
		}
	}
	return out
}

// exposeCmd shells out to the expose CLI. launchd's PATH is minimal, so
// extend it for cloudflared.
func exposeCmd(args ...string) (string, error) {
	home, _ := os.UserHomeDir()
	cmd := exec.Command(filepath.Join(home, ".local", "bin", "expose.py"), args...)
	cmd.Env = append(os.Environ(), "PATH="+os.Getenv("PATH")+":/opt/homebrew/bin:/usr/local/bin")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func validSub(s string) bool {
	if s == "" || len(s) > 63 {
		return false
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
			return false
		}
	}
	return s[0] != '-' && s[len(s)-1] != '-'
}

func randSub() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
