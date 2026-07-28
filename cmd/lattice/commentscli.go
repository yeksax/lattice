package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
)

func localCommentsAPI(method, path string, body any) (*http.Response, error) {
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
	return apiClient().Do(req)
}

func localThreads(slug string) ([]localThread, error) {
	resp, err := localCommentsAPI(http.MethodGet, "/api/comments/"+url.PathEscape(slug)+"/threads", nil)
	if err != nil {
		return nil, err
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
		return nil, errors.New(out.Error)
	}
	var threads []localThread
	if err := json.NewDecoder(resp.Body).Decode(&threads); err != nil {
		return nil, err
	}
	return threads, nil
}

func localThreadMutation(slug, path string, body any) error {
	resp, err := localCommentsAPI(
		http.MethodPost,
		"/api/comments/"+url.PathEscape(slug)+path,
		body,
	)
	if err != nil {
		return err
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

func localThreadsList(slug string, onlyOpen, rawJSON bool) error {
	threads, err := localThreads(slug)
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
		fmt.Printf("%s  %s  %s  local\n", thread.ID, thread.Status, thread.Selector)
		for _, comment := range thread.Comments {
			fmt.Printf("  %s: %s\n", comment.Author, comment.Body)
		}
	}
	if shown == 0 {
		fmt.Println("no threads")
	}
	return nil
}

func localCreateThread(slug, selector, message string) error {
	return localThreadMutation(slug, "/threads", map[string]string{
		"selector":    selector,
		"body":        message,
		"author":      "Agent",
		"author_kind": "agent",
	})
}

func localReply(slug, threadID, message string) error {
	return localThreadMutation(
		slug,
		"/threads/"+url.PathEscape(threadID)+"/comments",
		map[string]string{
			"body":        message,
			"author":      "Agent",
			"author_kind": "agent",
		},
	)
}

// localDropThread deletes a thread through the daemon, which removes the local
// copy and the hosted one together. `--hosted` skips the local half, for a
// thread that only ever existed on the public snapshot.
func localDropThread(slug, threadID string, onlyHosted bool) error {
	if onlyHosted {
		if err := hostedDropThread(loadConfigClient(), slug, threadID); err != nil {
			return err
		}
		fmt.Printf("deleted %s\n", threadID)
		return nil
	}
	resp, err := localCommentsAPI(
		http.MethodDelete,
		"/api/comments/"+url.PathEscape(slug)+"/threads/"+url.PathEscape(threadID),
		nil,
	)
	if err != nil {
		return err
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
	fmt.Printf("deleted %s\n", threadID)
	return nil
}

func localThreadStatus(slug, threadID, action string) error {
	if err := localThreadMutation(
		slug,
		"/threads/"+url.PathEscape(threadID)+"/"+action,
		nil,
	); err != nil {
		return err
	}
	past := map[string]string{"resolve": "resolved", "reopen": "reopened"}[action]
	fmt.Printf("%s %s\n", past, threadID)
	return nil
}
