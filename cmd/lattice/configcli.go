package main

// configcli.go - scriptable config access for people, agents, and automation.
// Reads/writes go through the daemon when available and fall back to the same
// atomic config file when it is not.

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func cliConfig(args []string) error {
	if len(args) == 0 {
		return printConfig(loadConfigClient())
	}

	switch args[0] {
	case "get":
		if len(args) == 1 {
			return printConfig(loadConfigClient())
		}
		if len(args) != 2 {
			return fmt.Errorf("usage: lattice config get [key]")
		}
		value, ok := configValue(loadConfigClient(), args[1])
		if !ok {
			return fmt.Errorf("unknown config key: %s", args[1])
		}
		fmt.Println(value)
		return nil
	case "set":
		if len(args) != 3 {
			return fmt.Errorf("usage: lattice config set <key> <value>")
		}
		return setConfigValue(args[1], args[2])
	case "unset":
		if len(args) != 2 {
			return fmt.Errorf("usage: lattice config unset <key>")
		}
		return setConfigValue(args[1], "")
	default:
		return fmt.Errorf("usage: lattice config [get [key] | set <key> <value> | unset <key>]")
	}
}

func printConfig(c Config) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}

func configValue(c Config, key string) (string, bool) {
	switch key {
	case "theme.preset":
		return c.Theme.Preset, true
	case "theme.accent":
		return c.Theme.Accent, true
	case "theme.font":
		return c.Theme.Font, true
	case "theme.density":
		return c.Theme.Density, true
	case "hosted.apiBase":
		return c.Hosted.APIBase, true
	case "hosted.token":
		return c.Hosted.Token, true
	default:
		return "", false
	}
}

func setConfigValue(key, value string) error {
	if err := validateConfigValue(key, value); err != nil {
		return err
	}
	c := loadConfigClient()
	switch key {
	case "theme.preset":
		c.Theme.Preset = value
	case "theme.accent":
		c.Theme.Accent = strings.ToLower(value)
	case "theme.font":
		c.Theme.Font = value
	case "theme.density":
		c.Theme.Density = value
	case "hosted.apiBase":
		c.Hosted.APIBase = strings.TrimRight(value, "/")
	case "hosted.token":
		c.Hosted.Token = value
	default:
		return fmt.Errorf("unknown config key: %s", key)
	}
	if err := saveConfigClient(c); err != nil {
		return err
	}
	fmt.Printf("%s = %s\n", key, value)
	return nil
}

func validateConfigValue(key, value string) error {
	validChoice := func(options ...string) bool {
		for _, option := range options {
			if value == option {
				return true
			}
		}
		return false
	}

	switch key {
	case "theme.preset":
		if !validChoice("", "lattice", "warm", "mono") {
			return fmt.Errorf("theme.preset must be lattice, warm, mono, or empty")
		}
	case "theme.accent":
		if value != "" && !hexColor.MatchString(value) {
			return fmt.Errorf("theme.accent must be a six-digit hex color such as #c2410c")
		}
	case "theme.font":
		if !validChoice("", "mono", "sans", "serif") {
			return fmt.Errorf("theme.font must be mono, sans, serif, or empty")
		}
	case "theme.density":
		if !validChoice("", "compact", "comfortable", "spacious") {
			return fmt.Errorf("theme.density must be compact, comfortable, spacious, or empty")
		}
	case "hosted.apiBase":
		if value != "" {
			u, err := url.Parse(value)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
				return fmt.Errorf("hosted.apiBase must be an absolute http(s) URL without a query or fragment")
			}
		}
	case "hosted.token":
		// Opaque credential; no client-side shape assumptions.
	default:
		return fmt.Errorf("unknown config key: %s", key)
	}
	return nil
}

func validateConfig(c Config) error {
	values := []struct{ key, value string }{
		{"theme.preset", c.Theme.Preset},
		{"theme.accent", c.Theme.Accent},
		{"theme.font", c.Theme.Font},
		{"theme.density", c.Theme.Density},
		{"hosted.apiBase", c.Hosted.APIBase},
		{"hosted.token", c.Hosted.Token},
	}
	for _, item := range values {
		if err := validateConfigValue(item.key, item.value); err != nil {
			return err
		}
	}
	return nil
}
