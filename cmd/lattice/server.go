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
	"runtime"
	"strings"
	"time"
)

//go:embed dashboard
var dashboardFS embed.FS

type server struct {
	ix     *Index
	assets map[string]asset // pre-hashed embedded files
	reload []byte           // reload.js, wrapped at request time
	poll   []byte           // poll.js bridge
	devDir string           // LATTICE_DEV: serve dashboard from disk (live reload)
	bootID string           // per-process id; moves the dev-reload digest on restart
}

type asset struct {
	body  []byte
	etag  string
	ctype string
}

func newServer(ix *Index) *server {
	s := &server{ix: ix, assets: map[string]asset{}, bootID: fmt.Sprintf("%x", time.Now().UnixNano())}
	for name, ctype := range map[string]string{
		"index.html": "text/html; charset=utf-8",
		"style.css":  "text/css; charset=utf-8",
		"i18n.js":    "text/javascript; charset=utf-8",
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
	if dir := devDashboardDir(); dir != "" {
		s.devDir = dir
		log.Printf("dev mode: serving dashboard from %s (live reload on)", dir)
	}
	return s
}

// devDashboardDir returns the on-disk dashboard source dir when LATTICE_DEV is
// set AND the sources are present, else "" (embed mode). LATTICE_DEV=1 locates
// dashboard/ next to this source file - which works when running from the repo
// via `go run`/wgo; LATTICE_DEV=/abs/path points at it explicitly.
func devDashboardDir() string {
	v := os.Getenv("LATTICE_DEV")
	if v == "" || v == "0" {
		return ""
	}
	dir := v
	if v == "1" || v == "true" {
		_, file, _, ok := runtime.Caller(0)
		if !ok {
			log.Print("LATTICE_DEV set but source path is unknown; serving embedded dashboard")
			return ""
		}
		dir = filepath.Join(filepath.Dir(file), "dashboard")
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		log.Printf("LATTICE_DEV set but %q is not a dashboard dir; serving embedded dashboard", dir)
		return ""
	}
	return dir
}

// readDash returns a dashboard file's bytes - fresh from disk in dev mode,
// otherwise from the embedded FS.
func (s *server) readDash(name string) ([]byte, error) {
	if s.devDir != "" {
		return os.ReadFile(filepath.Join(s.devDir, name))
	}
	return dashboardFS.ReadFile("dashboard/" + name)
}

// reloadJS and pollJS return the scripts injected into summary pages, read
// fresh from disk in dev mode so editing them hot-reloads too.
func (s *server) reloadJS() []byte {
	if s.devDir != "" {
		if b, err := s.readDash("reload.js"); err == nil {
			return b
		}
	}
	return s.reload
}

func (s *server) pollJS() []byte {
	if s.devDir != "" {
		if b, err := s.readDash("poll.js"); err == nil {
			return b
		}
	}
	return s.poll
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
	if s.devDir != "" {
		mux.HandleFunc("GET /api/dev-reload", s.watchDashboard)
	}
	return mux
}

func (s *server) getConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, loadConfig())
}

// putConfig replaces the whole config document. The app reads, edits, and
// PUTs back the full object - last write wins, which is fine for a
// single-user local tool.
func (s *server) putConfig(w http.ResponseWriter, r *http.Request) {
	var c *Config
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&c); err != nil {
		httpErr(w, http.StatusBadRequest, "body must be a Config JSON object")
		return
	}
	if c == nil {
		httpErr(w, http.StatusBadRequest, "body must be a Config JSON object")
		return
	}
	if err := validateConfig(*c); err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := saveConfig(*c); err != nil {
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
	if s.devDir != "" {
		s.assetDev(w, a, name)
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

// devReloadTag is injected into the dashboard's index.html in dev mode only. It
// opens the /api/dev-reload SSE stream and reloads when the digest changes -
// i.e. a dashboard file was edited, or the daemon was rebuilt and restarted
// (the boot id moves). No build step, no dependency.
const devReloadTag = `<script>(()=>{let s=null;new EventSource("/api/dev-reload").addEventListener("state",e=>{if(s!==null&&e.data!==s)location.reload();s=e.data});})();</script>`

// assetDev serves a dashboard file straight from disk with no caching and
// injects the live-reload client into index.html. Dev mode only; falls back to
// the embedded bytes if the file vanishes mid-save.
func (s *server) assetDev(w http.ResponseWriter, a asset, name string) {
	b, err := s.readDash(name)
	if err != nil {
		b = a.body
	}
	if name == "index.html" {
		b = injectScript(b, devReloadTag)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", a.ctype)
	w.Write(b)
}

// watchDashboard is the dev-only SSE stream behind dashboard live reload. The
// state is the boot id plus a digest of every dashboard file's mtime+size, so
// it moves on any source edit and on daemon restart. It reuses the same ticker
// poll as summary hot reload (see sse) - fsnotify misses atomic-rename saves.
func (s *server) watchDashboard(w http.ResponseWriter, r *http.Request) {
	sse(w, r, func() string {
		return s.bootID + "-" + s.dashDigest()
	}, nil)
}

func (s *server) dashDigest() string {
	h := sha256.New()
	for _, name := range []string{"index.html", "style.css", "i18n.js", "app.js", "poll.js", "reload.js"} {
		if fi, err := os.Stat(filepath.Join(s.devDir, name)); err == nil {
			fmt.Fprintf(h, "%s:%d:%d;", name, fi.ModTime().UnixNano(), fi.Size())
		} else {
			fmt.Fprintf(h, "%s:missing;", name)
		}
	}
	return fmt.Sprintf("%x", h.Sum(nil)[:8])
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
	b, err := os.ReadFile(resolveSource(slug))
	if err != nil {
		httpErr(w, http.StatusNotFound, "summary missing (source deleted?): "+slug)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Get("raw") == "1" {
		w.Write(b)
		return
	}
	tags := `<script id="lattice-poll" data-endpoint="/api/polls/` + slug + `/submit" data-results="/api/polls/` + slug + `/results">` + string(s.pollJS()) + `</script>` +
		`<script id="lattice-reload" data-slug="` + slug + `">` + string(s.reloadJS()) + `</script>`
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

// Share endpoints proxy to the hosted backend (lattice.pub) so the dashboard's
// share popover and the CLI publish through the same path. Not being logged in
// reads as "nothing shared" on GET and a clear error on mutations.
func (s *server) listShares(w http.ResponseWriter, _ *http.Request) {
	c := loadConfig()
	if c.Hosted.Token == "" {
		writeJSON(w, []hostedShareRow{})
		return
	}
	shares, err := hostedList(c)
	if err != nil {
		httpErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, shares)
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
	c := loadConfig()
	if c.Hosted.Token == "" {
		httpErr(w, http.StatusUnauthorized, errNotLoggedIn.Error())
		return
	}
	html, err := os.ReadFile(resolveSource(req.Slug))
	if err != nil {
		httpErr(w, http.StatusNotFound, "summary not found (or source missing): "+req.Slug)
		return
	}
	url, err := hostedCreate(c, req.Slug, html, req.Random)
	if err != nil {
		httpErr(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{"slug": req.Slug, "url": url})
}

func (s *server) deleteShare(w http.ResponseWriter, r *http.Request) {
	c := loadConfig()
	if c.Hosted.Token == "" {
		httpErr(w, http.StatusUnauthorized, errNotLoggedIn.Error())
		return
	}
	if err := hostedDelete(c, r.PathValue("slug")); err != nil {
		httpErr(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listPoll(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	writeJSON(w, map[string]any{"slug": slug, "submissions": readSubmissions(slug)})
}

func (s *server) submitPoll(w http.ResponseWriter, r *http.Request) {
	recordSubmission(w, r, r.PathValue("slug"))
}

func (s *server) pollResults(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, aggregate(r.PathValue("slug")))
}

// watchSummary is the SSE stream behind hot reload. It stat-polls the
// resolved source (editors save via atomic rename, which breaks per-file
// fsnotify watches) and pushes a state event whenever mtime/size change. The
// source is re-resolved on every poll so rm/add cycles pick up a new path.
func (s *server) watchSummary(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	sse(w, r, func() string {
		fi, err := os.Stat(resolveSource(slug))
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
