package main

// config.go - user-editable settings living at
// ~/.summaries/.lattice/config.json. Unlike meta sidecars (one per summary),
// this is a single global document read by three consumers: the daemon (to
// serve it over the API), the CLI (hosted token), and the html-summary skill
// (theme when generating new summaries). The daemon owns writes so UI clients
// never race the file - the dashboard PUTs to /api/config.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Theme drives how the html-summary skill styles generated summaries. All
// fields are optional; an empty value means "skill default".
type Theme struct {
	Preset   string `json:"preset,omitempty"`   // named starting point, e.g. "lattice", "warm", "mono"
	Accent   string `json:"accent,omitempty"`   // hex accent colour
	Font     string `json:"font,omitempty"`     // body: "mono" | "sans" | "serif"
	Heading  string `json:"heading,omitempty"`  // headings + big numbers: "mono" | "sans" | "serif"
	Density  string `json:"density,omitempty"`  // "compact" | "comfortable" | "spacious"
	Tone     string `json:"tone,omitempty"`     // "" | "neutral" | "zinc" | "mist" — page base temperature
	Dividers string `json:"dividers,omitempty"` // "" | "hairline" | "soft" | "none" — border/separator rules
	Modules  string `json:"modules,omitempty"`  // "" | "mixed" | "cards" | "stacks" — peers apart vs joined
}

// Hosted holds the credentials for the share backend (lattice.pub). Empty
// Token means the user isn't logged in and sharing is unavailable.
type Hosted struct {
	APIBase string `json:"apiBase,omitempty"` // e.g. https://api.lattice.pub
	Token   string `json:"token,omitempty"`   // Bearer token
}

// Config is the whole document. Version lets us migrate the shape later.
type Config struct {
	Version int    `json:"version"`
	Theme   Theme  `json:"theme"`
	Hosted  Hosted `json:"hosted"`
}

const configVersion = 1

// defaultAPIBase is where hosted commands point when the config doesn't
// override it. Overridable so `wrangler dev` / self-hosters can retarget.
const defaultAPIBase = "https://api.lattice.pub"

func configFile() string { return filepath.Join(summariesDir(), ".lattice", "config.json") }

// configMu guards the on-disk file against concurrent writers within the
// daemon (the API handler and any CLI-in-same-process path).
var configMu sync.Mutex

// loadConfig reads the config, returning a zero-value (but versioned) Config
// when the file is absent or unreadable - callers always get something usable.
func loadConfig() Config {
	configMu.Lock()
	defer configMu.Unlock()
	return readConfigLocked()
}

func readConfigLocked() Config {
	c := Config{Version: configVersion}
	b, err := os.ReadFile(configFile())
	if err != nil {
		return c
	}
	json.Unmarshal(b, &c) // best-effort; partial/garbage falls back to defaults
	if c.Version == 0 {
		c.Version = configVersion
	}
	return c
}

// saveConfig atomically writes the config (write-temp-then-rename) so a reader
// never observes a half-written file.
func saveConfig(c Config) error {
	if c.Version == 0 {
		c.Version = configVersion
	}
	configMu.Lock()
	defer configMu.Unlock()
	return writeConfigLocked(c)
}

func writeConfigLocked(c Config) error {
	if err := os.MkdirAll(filepath.Dir(configFile()), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := configFile() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil { // 0600: holds the hosted token
		return err
	}
	return os.Rename(tmp, configFile())
}

// resolvedAPIBase returns the hosted API base, honouring an override in the
// config and the LATTICE_API_BASE env var (used by dev / self-host).
func (c Config) resolvedAPIBase() string {
	if e := os.Getenv("LATTICE_API_BASE"); e != "" {
		return strings.TrimRight(e, "/")
	}
	if c.Hosted.APIBase != "" {
		return strings.TrimRight(c.Hosted.APIBase, "/")
	}
	return defaultAPIBase
}
