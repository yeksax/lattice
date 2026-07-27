package main

// statecli.go - `lattice state`, the CLI half of the persistence bridge.
// Reading it is how an agent finds out what the human actually ticked; writing
// it is how an agent pre-fills a checklist. Local state goes through the daemon
// (falling back to the file when it is down, like add/rm); `--hosted` talks to
// the share backend instead.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
)

// --- local (daemon) -----------------------------------------------------------

// localStateAPI calls the daemon, spawning it once if it is down. Callers fall
// back to touching the file directly when even that fails - the daemon rereads
// it on every request, so nothing needs reconciling afterwards.
func localStateAPI(method, path string, body any) (*http.Response, error) {
	build := func() (*http.Request, error) {
		var payload *bytes.Reader
		if body == nil {
			payload = bytes.NewReader(nil)
		} else {
			b, err := json.Marshal(body)
			if err != nil {
				return nil, err
			}
			payload = bytes.NewReader(b)
		}
		req, err := http.NewRequest(method, baseURL()+path, payload)
		if err != nil {
			return nil, err
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		return req, nil
	}
	req, err := build()
	if err != nil {
		return nil, err
	}
	resp, err := apiClient().Do(req)
	if err != nil && ensureServer() == nil {
		if retry, berr := build(); berr == nil {
			resp, err = apiClient().Do(retry)
		}
	}
	return resp, err
}

func stateAPIError(resp *http.Response) error {
	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.Error == "" {
		out.Error = resp.Status
	}
	return errors.New(out.Error)
}

func localStateSet(slug, viewer string, ops []stateOp) error {
	resp, err := localStateAPI(http.MethodPost, "/api/state/"+url.PathEscape(slug), map[string]any{
		"viewer": viewer,
		"ops":    ops,
	})
	if err != nil {
		_, derr := applyState(slug, viewer, ops) // daemon down - write the file
		return derr
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return stateAPIError(resp)
	}
	return nil
}

func localStateClear(slug, scope, viewer, key string) (int, error) {
	q := url.Values{}
	if scope != "" {
		q.Set("scope", scope)
	}
	if viewer != "" {
		q.Set("viewer", viewer)
	}
	if key != "" {
		q.Set("key", key)
	}
	path := "/api/state/" + url.PathEscape(slug)
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	resp, err := localStateAPI(http.MethodDelete, path, nil)
	if err != nil {
		return clearState(slug, scope, viewer, key)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, stateAPIError(resp)
	}
	var out struct {
		Removed int `json:"removed"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return out.Removed, nil
}

// --- hosted -------------------------------------------------------------------

type hostedStateDoc struct {
	Slug     string                                `json:"slug"`
	Document map[string]json.RawMessage            `json:"document"`
	Users    map[string]map[string]json.RawMessage `json:"users"`
}

func hostedState(c Config, slug string) (hostedStateDoc, error) {
	var doc hostedStateDoc
	if c.Hosted.Token == "" {
		return doc, errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodGet, "/v1/shares/"+url.PathEscape(slug)+"/state", nil)
	if err != nil {
		return doc, fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return doc, stateAPIError(resp)
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return doc, err
	}
	return doc, nil
}

func hostedStateSet(c Config, slug, viewer string, ops []stateOp) error {
	if c.Hosted.Token == "" {
		return errNotLoggedIn
	}
	resp, err := hostedAPI(c, http.MethodPost, "/v1/shares/"+url.PathEscape(slug)+"/state", map[string]any{
		"viewer": viewer,
		"ops":    ops,
	})
	if err != nil {
		return fmt.Errorf("hosted API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return stateAPIError(resp)
	}
	return nil
}

// --- command ------------------------------------------------------------------

type stateFlags struct {
	hosted  bool
	rawJSON bool
	scope   string
	viewer  string
}

func cliState(args []string, f stateFlags) error {
	if len(args) == 0 {
		return errors.New(`usage: lattice state <slug> | state set <slug> <key> <value> | state rm <slug> <key> | state clear <slug>`)
	}
	switch args[0] {
	case "set":
		if len(args) != 4 {
			return errors.New("usage: lattice state set <slug> <key> <value> [--scope user] [--user id] [--hosted]")
		}
		return stateSetCmd(args[1], args[2], args[3], f)
	case "rm", "remove", "unset":
		if len(args) != 3 {
			return errors.New("usage: lattice state rm <slug> <key> [--scope user] [--user id] [--hosted]")
		}
		return stateRemoveCmd(args[1], args[2], f)
	case "clear":
		if len(args) != 2 {
			return errors.New("usage: lattice state clear <slug> [--scope document|user] [--user id] [--hosted]")
		}
		return stateClearCmd(args[1], f)
	default:
		if len(args) != 1 {
			return errors.New("usage: lattice state <slug> [--json] [--user id] [--hosted]")
		}
		return stateListCmd(args[0], f)
	}
}

// parseStateValue takes the argument as JSON when it is JSON (true, 12, "a",
// {...}) and as a plain string otherwise, so `lattice state set s k done` does
// what it looks like it does.
func parseStateValue(raw string) json.RawMessage {
	trimmed := strings.TrimSpace(raw)
	if json.Valid([]byte(trimmed)) && trimmed != "" {
		return json.RawMessage(trimmed)
	}
	b, _ := json.Marshal(raw)
	return json.RawMessage(b)
}

func stateSetCmd(slug, key, raw string, f stateFlags) error {
	scope := normalizeScope(f.scope)
	if scope == scopeUser && f.viewer == "" {
		return errors.New("--scope user needs --user <viewer-id> (see: lattice state <slug>)")
	}
	ops := []stateOp{{Key: key, Scope: scope, Value: parseStateValue(raw)}}
	if f.hosted {
		if err := hostedStateSet(loadConfigClient(), slug, f.viewer, ops); err != nil {
			return err
		}
	} else if err := localStateSet(slug, f.viewer, ops); err != nil {
		return err
	}
	fmt.Printf("set %s [%s] = %s\n", key, scope, string(ops[0].Value))
	return nil
}

func stateRemoveCmd(slug, key string, f stateFlags) error {
	scope := normalizeScope(f.scope)
	if f.hosted {
		if err := hostedStateSet(loadConfigClient(), slug, f.viewer, []stateOp{{Key: key, Scope: scope, Delete: true}}); err != nil {
			return err
		}
		fmt.Printf("removed %s [%s]\n", key, scope)
		return nil
	}
	removed, err := localStateClear(slug, scope, f.viewer, key)
	if err != nil {
		return err
	}
	fmt.Printf("removed %d key(s)\n", removed)
	return nil
}

func stateClearCmd(slug string, f stateFlags) error {
	if f.hosted {
		c := loadConfigClient()
		doc, err := hostedState(c, slug)
		if err != nil {
			return err
		}
		cleared := 0
		if f.scope == "" || normalizeScope(f.scope) == scopeDocument {
			var ops []stateOp
			for key := range doc.Document {
				ops = append(ops, stateOp{Key: key, Scope: scopeDocument, Delete: true})
			}
			if len(ops) > 0 {
				if err := hostedStateSet(c, slug, "", ops); err != nil {
					return err
				}
				cleared += len(ops)
			}
		}
		if f.scope == "" || normalizeScope(f.scope) == scopeUser {
			// User ops apply to one viewer per request, so a multi-reader clear
			// is one request per reader.
			for viewer, keys := range doc.Users {
				if f.viewer != "" && viewer != f.viewer {
					continue
				}
				var ops []stateOp
				for key := range keys {
					ops = append(ops, stateOp{Key: key, Scope: scopeUser, Delete: true})
				}
				if len(ops) == 0 {
					continue
				}
				if err := hostedStateSet(c, slug, viewer, ops); err != nil {
					return err
				}
				cleared += len(ops)
			}
		}
		if cleared == 0 {
			fmt.Println("nothing to clear")
			return nil
		}
		fmt.Printf("cleared %d key(s)\n", cleared)
		return nil
	}
	scope := ""
	if f.scope != "" {
		scope = normalizeScope(f.scope)
	}
	removed, err := localStateClear(slug, scope, f.viewer, "")
	if err != nil {
		return err
	}
	fmt.Printf("cleared %d key(s)\n", removed)
	return nil
}

func stateListCmd(slug string, f stateFlags) error {
	document := map[string]json.RawMessage{}
	users := map[string]map[string]json.RawMessage{}

	if f.hosted {
		doc, err := hostedState(loadConfigClient(), slug)
		if err != nil {
			return err
		}
		document, users = doc.Document, doc.Users
	} else {
		// ?all=1: the CLI wants every reader's keys, not one viewer's window.
		resp, err := localStateAPI(http.MethodGet, "/api/state/"+url.PathEscape(slug)+"?all=1", nil)
		if err != nil {
			snapshot, serr := stateSnapshot(slug) // daemon down - read the file
			if serr != nil {
				return serr
			}
			unwrapped := unwrapState(slug, snapshot)
			document, users = unwrapped.Document, unwrapped.Users
		} else {
			defer resp.Body.Close()
			if resp.StatusCode >= 300 {
				return stateAPIError(resp)
			}
			var out stateSnapshotDoc
			if derr := json.NewDecoder(resp.Body).Decode(&out); derr != nil {
				return derr
			}
			document, users = out.Document, out.Users
		}
	}

	if f.viewer != "" {
		if keys, ok := users[f.viewer]; ok {
			users = map[string]map[string]json.RawMessage{f.viewer: keys}
		} else {
			users = map[string]map[string]json.RawMessage{}
		}
	}

	if f.rawJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{"slug": slug, "document": document, "users": users})
	}

	rows := 0
	for _, key := range sortedKeys(document) {
		fmt.Printf("%-8s  %-40s  %s\n", scopeDocument, key, string(document[key]))
		rows++
	}
	for _, viewer := range sortedViewers(users) {
		for _, key := range sortedKeys(users[viewer]) {
			fmt.Printf("%-8s  %-40s  %s  (viewer %s)\n", scopeUser, key, string(users[viewer][key]), viewer)
			rows++
		}
	}
	if rows == 0 {
		fmt.Println("no state stored")
	}
	return nil
}

func sortedKeys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedViewers(m map[string]map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
