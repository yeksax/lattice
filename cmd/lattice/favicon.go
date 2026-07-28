package main

// favicon.go - the daemon fetches the icon for a domain-gated share's allowed
// domain, so the dashboard can show *whose* sign-in a link is behind instead of
// a bare string.
//
// Why the daemon and not the browser: the obvious one-liner is an <img> pointed
// at a favicon service, which would hand a third party the list of companies
// this person shares documents with. Here the only host contacted is the domain
// itself, the answer is cached on disk, and a domain that has no icon degrades
// to a monogram the dashboard draws locally.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	faviconTTL      = 30 * 24 * time.Hour // a logo does not change often
	faviconMissTTL  = 24 * time.Hour      // retry a domain without an icon tomorrow
	faviconMaxBytes = 256 << 10
	faviconTimeout  = 6 * time.Second
)

var (
	faviconMu     sync.Mutex
	faviconGroup  = map[string]chan struct{}{} // domain -> in-flight fetch
	reIconDomain  = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	reIconLink    = regexp.MustCompile(`(?is)<link\s[^>]*>`)
	reIconRel     = regexp.MustCompile(`(?i)rel\s*=\s*["']?([^"'>]*)`)
	reIconHref    = regexp.MustCompile(`(?i)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
	faviconTypes  = map[string]string{"image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico", "image/png": ".png", "image/svg+xml": ".svg", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
	errNoIcon     = errors.New("no icon")
	faviconClient = &http.Client{
		Timeout: faviconTimeout,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout: 4 * time.Second,
				// A summary rendered in the reader is agent-written HTML, and it
				// can call this endpoint. Refusing to dial anything but a public
				// address keeps that from turning the daemon into a scanner for
				// whatever is listening on the local network.
				Control: denyPrivateAddr,
			}).DialContext,
			TLSHandshakeTimeout: 4 * time.Second,
		},
	}
)

func faviconDir() string { return filepath.Join(summariesDir(), ".lattice", "favicons") }

// denyPrivateAddr rejects a connection to any address that is not globally
// routable: loopback, link-local, and the RFC1918 ranges an intranet lives on.
func denyPrivateAddr(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("refusing to dial %s", address)
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return fmt.Errorf("refusing to dial non-public address %s", host)
	}
	return nil
}

// getFavicon serves the icon for ?domain=, from disk when it is fresh.
func (s *server) getFavicon(w http.ResponseWriter, r *http.Request) {
	domain := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
	domain = strings.TrimPrefix(domain, "@")
	if len(domain) > 253 || !reIconDomain.MatchString(domain) || net.ParseIP(domain) != nil {
		httpErr(w, http.StatusBadRequest, "domain must be a hostname")
		return
	}

	path, contentType, err := cachedFavicon(domain)
	if err != nil {
		// Cached miss and live failure look the same to the caller: the
		// dashboard draws its monogram either way.
		httpErr(w, http.StatusNotFound, "no icon for "+domain)
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		httpErr(w, http.StatusNotFound, "no icon for "+domain)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	// The bytes came from someone else's server: refuse to let a browser treat
	// them as anything but the image type sniffed on the way in.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(b)
}

// cachedFavicon returns the on-disk path and content type for a domain's icon,
// fetching it when the cache is cold or stale. Concurrent callers for the same
// domain wait on the first one instead of stampeding the origin.
func cachedFavicon(domain string) (string, string, error) {
	if path, ct, ok := readFaviconCache(domain); ok {
		if path == "" {
			return "", "", errNoIcon
		}
		return path, ct, nil
	}

	faviconMu.Lock()
	if wait, busy := faviconGroup[domain]; busy {
		faviconMu.Unlock()
		<-wait
		if path, ct, ok := readFaviconCache(domain); ok && path != "" {
			return path, ct, nil
		}
		return "", "", errNoIcon
	}
	done := make(chan struct{})
	faviconGroup[domain] = done
	faviconMu.Unlock()

	defer func() {
		faviconMu.Lock()
		delete(faviconGroup, domain)
		faviconMu.Unlock()
		close(done)
	}()

	body, ext, err := fetchFavicon(domain)
	if err != nil {
		writeFaviconMiss(domain)
		return "", "", errNoIcon
	}
	os.MkdirAll(faviconDir(), 0o755)
	clearFaviconCache(domain)
	path := filepath.Join(faviconDir(), domain+ext)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		return "", "", err
	}
	return path, faviconContentType(ext), nil
}

// readFaviconCache reports the cached answer for a domain when it is still
// fresh. ok=false means "go fetch"; ok=true with an empty path is a cached miss.
func readFaviconCache(domain string) (string, string, bool) {
	if info, err := os.Stat(filepath.Join(faviconDir(), domain+".none")); err == nil {
		if time.Since(info.ModTime()) < faviconMissTTL {
			return "", "", true
		}
		return "", "", false
	}
	for ext, ct := range faviconExtTypes() {
		path := filepath.Join(faviconDir(), domain+ext)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if time.Since(info.ModTime()) >= faviconTTL {
			return "", "", false
		}
		return path, ct, true
	}
	return "", "", false
}

func clearFaviconCache(domain string) {
	for ext := range faviconExtTypes() {
		os.Remove(filepath.Join(faviconDir(), domain+ext))
	}
	os.Remove(filepath.Join(faviconDir(), domain+".none"))
}

func writeFaviconMiss(domain string) {
	os.MkdirAll(faviconDir(), 0o755)
	clearFaviconCache(domain)
	os.WriteFile(filepath.Join(faviconDir(), domain+".none"), nil, 0o644)
}

func faviconExtTypes() map[string]string {
	out := make(map[string]string, len(faviconTypes))
	for ct, ext := range faviconTypes {
		if _, seen := out[ext]; !seen {
			out[ext] = ct
		}
	}
	return out
}

func faviconContentType(ext string) string {
	if ct, ok := faviconExtTypes()[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}

// fetchFavicon tries /favicon.ico first (one request answers for most sites),
// then falls back to whatever the home page declares in <link rel="icon">.
func fetchFavicon(domain string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), faviconTimeout)
	defer cancel()

	if body, ext, err := downloadIcon(ctx, "https://"+domain+"/favicon.ico"); err == nil {
		return body, ext, nil
	}

	href, err := declaredIconURL(ctx, "https://"+domain+"/")
	if err != nil {
		return nil, "", err
	}
	return downloadIcon(ctx, href)
}

// declaredIconURL reads the <head> of a page and returns the best rel=icon it
// declares, resolved against the page URL.
func declaredIconURL(ctx context.Context, page string) (string, error) {
	body, final, err := getLimited(ctx, page, 128<<10, "text/html,application/xhtml+xml")
	if err != nil {
		return "", err
	}
	head := string(body)
	if i := strings.Index(strings.ToLower(head), "</head"); i >= 0 {
		head = head[:i]
	}

	best, bestRank := "", -1
	for _, tag := range reIconLink.FindAllString(head, -1) {
		rel := ""
		if m := reIconRel.FindStringSubmatch(tag); m != nil {
			rel = strings.ToLower(m[1])
		}
		rank := -1
		switch {
		case strings.Contains(rel, "apple-touch-icon"):
			rank = 2
		case strings.Contains(rel, "shortcut icon"), strings.Contains(rel, "icon"):
			// A plain rel="icon" is the canonical one; prefer it over the
			// Apple variant only when both are present as equals.
			rank = 1
		}
		if rank <= bestRank {
			continue
		}
		m := reIconHref.FindStringSubmatch(tag)
		if m == nil {
			continue
		}
		href := strings.TrimSpace(m[1] + m[2] + m[3])
		if href == "" || strings.HasPrefix(strings.ToLower(href), "data:") {
			continue
		}
		best, bestRank = href, rank
	}
	if best == "" {
		return "", errNoIcon
	}
	base, err := url.Parse(final)
	if err != nil {
		return "", err
	}
	ref, err := url.Parse(best)
	if err != nil {
		return "", err
	}
	resolved := base.ResolveReference(ref)
	if resolved.Scheme != "https" && resolved.Scheme != "http" {
		return "", errNoIcon
	}
	return resolved.String(), nil
}

func downloadIcon(ctx context.Context, href string) ([]byte, string, error) {
	body, _, err := getLimited(ctx, href, faviconMaxBytes, "image/*")
	if err != nil {
		return nil, "", err
	}
	if len(body) == 0 {
		return nil, "", errNoIcon
	}
	ext := sniffIconExt(body)
	if ext == "" {
		return nil, "", errNoIcon
	}
	return body, ext, nil
}

// sniffIconExt classifies by content, not by the served Content-Type: plenty of
// servers label a PNG as text/html, and an actual error page must not be cached
// as an icon.
func sniffIconExt(b []byte) string {
	switch {
	case len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n":
		return ".png"
	case len(b) >= 4 && string(b[:4]) == "\x00\x00\x01\x00":
		return ".ico"
	case len(b) >= 3 && string(b[:3]) == "\xff\xd8\xff":
		return ".jpg"
	case len(b) >= 6 && string(b[:6]) == "GIF89a", len(b) >= 6 && string(b[:6]) == "GIF87a":
		return ".gif"
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return ".webp"
	}
	head := strings.ToLower(strings.TrimSpace(string(b[:min(len(b), 256)])))
	if strings.HasPrefix(head, "<?xml") || strings.HasPrefix(head, "<svg") {
		return ".svg"
	}
	return ""
}

func getLimited(ctx context.Context, href string, limit int64, accept string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, href, nil)
	if err != nil {
		return nil, "", err
	}
	// Sites that vary on the UA hand a bare Go client a 403 and no icon.
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; lattice/1.0; +https://lattice.pub)")
	req.Header.Set("Accept", accept)
	resp, err := faviconClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return nil, "", err
	}
	return body, resp.Request.URL.String(), nil
}
