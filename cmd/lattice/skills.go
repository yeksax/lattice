package main

// skills.go - ships the lattice-integrated html-summary skill *inside* the
// binary and installs it into the agent skill directories. The standalone copy
// in the repo's skills/ folder has no lattice hooks; this embedded one documents
// theme config, `lattice add`, and the poll bridge, so it only makes sense once
// the CLI is present. `lattice skills install` writes it wherever agents look.

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// The embedded skill directory travels with the binary, so a user who only
// downloaded `lattice` (no repo checkout) can still install it.
//
//go:embed all:skill
var skillFS embed.FS

const skillName = "html-summary"

// defaultSkillTargets are the conventional per-user skill roots. Claude Code
// reads ~/.claude/skills; the cross-agent convention is ~/.agents/skills. We
// write both so any agent on the machine picks the skill up.
func defaultSkillTargets() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{
		filepath.Join(home, ".claude", "skills", skillName),
		filepath.Join(home, ".agents", "skills", skillName),
	}
}

func cliSkills(args []string) error {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "install":
		return skillsInstall(args[1:])
	default:
		return fmt.Errorf("usage: lattice skills install [--dir path] [--force]")
	}
}

func skillsInstall(args []string) error {
	fs := flag.NewFlagSet("skills install", flag.ExitOnError)
	dir := fs.String("dir", "", "install to a single directory instead of the default skill roots")
	force := fs.Bool("force", false, "overwrite an existing skill directory without prompting")
	fs.Parse(reorderFlags(args, "dir"))

	targets := defaultSkillTargets()
	if *dir != "" {
		targets = []string{filepath.Join(*dir, skillName)}
	}
	if len(targets) == 0 {
		return fmt.Errorf("could not resolve a home directory; pass --dir")
	}

	for _, dest := range targets {
		existed := dirExists(dest)
		if existed && !*force {
			// Idempotent by default: refresh our managed files in place. --force
			// additionally clears anything else the directory picked up.
			fmt.Printf("updating %s\n", dest)
		} else if existed {
			if err := os.RemoveAll(dest); err != nil {
				return fmt.Errorf("clearing %s: %w", dest, err)
			}
		}
		if err := writeSkill(dest); err != nil {
			return fmt.Errorf("installing to %s: %w", dest, err)
		}
		if !existed {
			fmt.Printf("installed %s\n", dest)
		}
	}
	fmt.Printf("skill %q ready — restart your agent session to pick it up\n", skillName)
	return nil
}

// writeSkill copies every embedded file under skill/ into dest, preserving the
// tree below the embed root.
func writeSkill(dest string) error {
	return fs.WalkDir(skillFS, "skill", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel("skill", path)
		if err != nil {
			return err
		}
		out := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		data, err := skillFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		return os.WriteFile(out, data, 0o644)
	})
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
