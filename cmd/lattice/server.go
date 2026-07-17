package main

// server.go - stdlib net/http, Go 1.22 pattern routing, no framework.
// The dashboard is embedded in the binary; /s/{slug} injects the hot-reload
// client into the RESPONSE ONLY - bytes on disk are never touched.

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed dashboard
var dashboardFS embed.FS

type server struct {
	ix     *Index
	sm     *shareManager
	assets map[string]asset // pre-hashed embedded files
	reload []byte           // reload.js, wrapped at request time
	poll   []byte           // poll.js bridge
}

type asset struct {
	body  []byte
	etag  string
	ctype string
}

func newServer(ix *Index, sm *shareManager) *server {
	s := &server{ix: ix, sm: sm, assets: map[string]asset{}}
	for name, ctype := range map[string]string{
		"index.html": "text/html; charset=utf-8",
		"style.css":  "text/css; charset=utf-8",
		"app.js":     "text/javascript; charset=utf-8",
	} {
		b, err := dashboardFS.ReadFile("dashboard/" + name)
		if err != nil {
			log.Fatalf("embedded asset missing: %s", name)
		}
		sum := sha256.Sum256(b)
		s.assets[name] = asset{body: b, etag: fmt.Sprintf(`"%x"`, sum[:8]), ctype: ctype}
	}
	rl, err := dashboardFS.ReadFile("dashboard/reload.js")
	if err != nil {
		log.Fatal("embedded reload.js missing")
	}
	s.reload = rl
	pl, err := dashboardFS.ReadFile("dashboard/poll.js")
	if err != nil {
		log.Fatal("embedded poll.js missing")
	}
	s.poll = pl
	return s
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { s.asset(w, r, "index.html") })
	mux.HandleFunc("GET /assets/{file}", func(w http.ResponseWriter, r *http.Request) { s.asset(w, r, r.PathValue("file")) })
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/config", s.getConfig)
	mux.HandleFunc("PUT /api/config", s.putConfig)
	mux.HandleFunc("GET /api/summaries", s.listSummaries)
	mux.HandleFunc("POST /api/summaries", s.postSummary)
	mux.HandleFunc("DELETE /api/summaries/{slug}", s.deleteSummary)
	mux.HandleFunc("GET /api/search", s.searchSummaries)
	mux.HandleFunc("GET /s/{slug}", s.serveSummary)
	mux.HandleFunc("GET /api/watch", s.watchLibrary)
	mux.HandleFunc("GET /api/watch/{slug}", s.watchSummary)
	mux.HandleFunc("GET /api/shares", s.listShares)
	mux.HandleFunc("POST /api/shares", s.postShare)
	mux.HandleFunc("DELETE /api/shares/{slug}", s.deleteShare)
	mux.HandleFunc("GET /api/polls/{slug}", s.listPoll)
	mux.HandleFunc("GET /api/polls/{slug}/results", s.pollResults)
	mux.HandleFunc("POST /api/polls/{slug}/submit", s.submitPoll)
	return localCORS(mux)
}

// localCORS lets the Tauri menubar app (origin tauri://localhost) call the
// loopback API from its webview. Only /api routes are opened up, and the
// server already binds loopback-only, so this is not a public-exposure risk.
// A non-/api request, or any request from another origin, passes through
// unchanged (no ACAO header ⇒ the browser blocks the cross-origin read).
func localCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && strings.HasPrefix(r.URL.Path, "/api/") && isAppOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// isAppOrigin matches the desktop app's webview origins across platforms
// (macOS/Linux: https://tauri.localhost in Tauri 2; also tauri:// and http://
// variants, plus localhost ports used by some webview/dev setups).
func isAppOrigin(origin string) bool {
	switch origin {
	case "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
		"asset://localhost", "http://asset.localhost", "https://asset.localhost":
		return true
	}
	return strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "https://localhost:")
}

func (s *server) getConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, loadConfig())
}

// putConfig replaces the whole config document. The app reads, edits, and
// PUTs back the full object - last write wins, which is fine for a
// single-user local tool.
func (s *server) putConfig(w http.ResponseWriter, r *http.Request) {
	var c Config
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&c); err != nil {
		httpErr(w, http.StatusBadRequest, "body must be a Config JSON object")
		return
	}
	if err := saveConfig(c); err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, loadConfig())
}

func (s *server) asset(w http.ResponseWriter, r *http.Request, name string) {
	a, ok := s.assets[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("ETag", a.etag)
	w.Header().Set("Cache-Control", "no-cache") // revalidate; ETag makes it a 304
	if r.Header.Get("If-None-Match") == a.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", a.ctype)
	w.Write(a.body)
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"ok": true, "docs": len(s.ix.list())})
}

func (s *server) listSummaries(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.ix.list())
}

func (s *server) postSummary(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path  string   `json:"path"`
		Title string   `json:"title"`
		Tags  []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
		httpErr(w, http.StatusBadRequest, "body must be JSON: {\"path\": \"/abs/file.html\", \"title\"?, \"tags\"?}")
		return
	}
	m, err := addSummary(req.Path, req.Title, req.Tags)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.ix.reindex(m.Slug) // index synchronously; fsnotify would race the response
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{"slug": m.Slug, "url": "/s/" + m.Slug, "meta": m})
}

func (s *server) deleteSummary(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if err := removeSummary(slug); err != nil {
		httpErr(w, http.StatusNotFound, err.Error())
		return
	}
	s.ix.reindex(slug)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) searchSummaries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	hits := s.ix.search(q)
	if hits == nil {
		hits = []Hit{}
	}
	writeJSON(w, map[string]any{"mode": "lexical", "query": q, "hits": hits})
}

// serveSummary streams the resolved HTML. Default: hot-reload client injected
// into the response. ?raw=1: pristine original bytes (shareable).
func (s *server) serveSummary(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if strings.Contains(slug, "/") || strings.Contains(slug, "..") {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(summariesDir(), slug+".html"))
	if err != nil {
		httpErr(w, http.StatusNotFound, "summary missing (target deleted?): "+slug)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Get("raw") == "1" {
		w.Write(b)
		return
	}
	tags := `<script id="lattice-poll" data-endpoint="/api/polls/` + slug + `/submit" data-results="/api/polls/` + slug + `/results">` + string(s.poll) + `</script>` +
		`<script id="lattice-reload" data-slug="` + slug + `">` + string(s.reload) + `</script>`
	w.Write(injectScript(b, tags))
}

// injectScript inserts markup before </body> (append as fallback) - into the
// response only, never the file.
func injectScript(b []byte, tag string) []byte {
	if i := bytes.LastIndex(bytes.ToLower(b), []byte("</body>")); i >= 0 {
		out := make([]byte, 0, len(b)+len(tag))
		out = append(out, b[:i]...)
		out = append(out, tag...)
		return append(out, b[i:]...)
	}
	return append(b, tag...)
}

func (s *server) listShares(w http.ResponseWriter, _ *http.Request) {
	out := []map[string]any{}
	for _, sh := range s.sm.list() {
		out = append(out, map[string]any{
			"slug": sh.Slug, "sub": sh.Sub, "port": sh.Port,
			"url": sh.URL(), "created": sh.Created,
			"votes": len(readSubmissions(sh.Slug)),
		})
	}
	writeJSON(w, out)
}

func (s *server) postShare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Slug   string `json:"slug"`
		Random bool   `json:"random"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Slug == "" {
		httpErr(w, http.StatusBadRequest, `body must be JSON: {"slug", "random"?}`)
		return
	}
	sh, err := s.sm.create(req.Slug, req.Random)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{"slug": sh.Slug, "url": sh.URL(), "port": sh.Port})
}

func (s *server) deleteShare(w http.ResponseWriter, r *http.Request) {
	if err := s.sm.remove(r.PathValue("slug")); err != nil {
		httpErr(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listPoll(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	writeJSON(w, map[string]any{"slug": slug, "submissions": readSubmissions(slug)})
}

func (s *server) submitPoll(w http.ResponseWriter, r *http.Request) {
	recordSubmission(w, r, r.PathValue("slug"), "local")
}

func (s *server) pollResults(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, aggregate(r.PathValue("slug")))
}

// watchSummary is the SSE stream behind hot reload. It stat-polls the
// resolved target (editors save via atomic rename, which breaks per-file
// fsnotify watches) and pushes a state event whenever mtime/size change.
func (s *server) watchSummary(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	path := filepath.Join(summariesDir(), slug+".html")
	sse(w, r, func() string {
		fi, err := os.Stat(path)
		if err != nil {
			return "missing"
		}
		return fmt.Sprintf("%d-%d", fi.ModTime().UnixNano(), fi.Size())
	}, func() {
		s.ix.reindex(slug) // keep search fresh too - content just changed
	})
}

// watchLibrary is the SSE stream behind the dashboard's autosync. The state is
// a digest of exactly what /api/summaries returns, so any add, delete, retitle,
// retag or target edit moves it - and nothing else does.
func (s *server) watchLibrary(w http.ResponseWriter, r *http.Request) {
	sse(w, r, func() string {
		b, err := json.Marshal(s.ix.list()) // list() also reconciles missing targets
		if err != nil {
			return "error"
		}
		sum := sha256.Sum256(b)
		return fmt.Sprintf("%x", sum[:8])
	}, nil)
}

// sse pushes state() on connect and then on every change, calling onChange (if
// given) first. state is called on a ticker rather than driven by fsnotify
// because the things worth watching - atomic-rename saves, and symlink targets
// living outside ~/.summaries - are exactly the ones fsnotify misses.
func sse(w http.ResponseWriter, r *http.Request, state func() string, onChange func()) {
	fl, ok := w.(http.Flusher)
	if !ok {
		httpErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")

	last := state()
	fmt.Fprintf(w, "event: state\ndata: %s\n\n", last)
	fl.Flush()

	poll := time.NewTicker(500 * time.Millisecond)
	ping := time.NewTicker(20 * time.Second)
	defer poll.Stop()
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case <-poll.C:
			if cur := state(); cur != last {
				last = cur
				if onChange != nil {
					onChange()
				}
				fmt.Fprintf(w, "event: state\ndata: %s\n\n", cur)
				fl.Flush()
			}
		}
	}
}

// loopbackOnly guards the port-80 alias listener (summaries.localhost). macOS
// only allows unprivileged low-port binds on the wildcard address, so we bind
// :80 and enforce loopback at the request level - LAN peers get 403.
func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
