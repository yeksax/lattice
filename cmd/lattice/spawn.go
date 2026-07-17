package main

// spawn.go - daemon auto-spawn. When a CLI command finds the daemon
// unreachable it re-executes this same binary as `lattice serve`, detached,
// and waits briefly for health. This is the default lifecycle on platforms
// without launchd (and a convenience on macOS); `lattice service install`
// (later) is the robust always-on path. Set LATTICE_NO_AUTOSPAWN=1 to opt out.

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var errServerDown = errors.New("server not running")

func serverUp() bool {
	resp, err := apiClient().Get(baseURL() + "/api/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ensureServer makes a best effort to leave a healthy daemon running: already
// up ⇒ nil; down ⇒ spawn + wait. Callers treat a non-nil return as "still
// down" and fall back to their direct/offline paths.
func ensureServer() error {
	if serverUp() {
		return nil
	}
	if os.Getenv("LATTICE_NO_AUTOSPAWN") != "" {
		return errServerDown
	}
	if err := spawnDaemon(); err != nil {
		return fmt.Errorf("auto-spawn daemon: %w", err)
	}
	for range 50 {
		time.Sleep(100 * time.Millisecond)
		if serverUp() {
			return nil
		}
	}
	return errServerDown
}

func daemonLogFile() string {
	return filepath.Join(summariesDir(), ".lattice", "lattice.log")
}
