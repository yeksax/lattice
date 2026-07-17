package main

// lattice - personal knowledge base for single-file HTML summaries.
// One binary: `lattice serve` is the launchd daemon; add/ls/rm/open are the
// CLI client against it.

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

func listenAddr() string {
	if a := os.Getenv("LATTICE_ADDR"); a != "" {
		return a
	}
	return "127.0.0.1:4600"
}

const usage = `lattice - HTML summary knowledge base

usage:
  lattice serve                      run the server (launchd does this)
  lattice add <file.html> [flags]    symlink a summary into ~/.summaries
      --title <t>    override the cached title
      --tags a,b,c   tag the summary
      --no-open      don't open the browser
  lattice ls                         list summaries
  lattice rm <slug>                  remove symlink + metadata (never the original)
  lattice open [slug|file.html]      open the dashboard, a summary by slug,
                                     or a file (added on the fly)
  lattice login <token> [--api url]  log in to hosted sharing (Cloudflare)
  lattice logout                     forget the hosted token (revert to local)
  lattice share <slug> [flags]       share ONE summary publicly
      --random     8-char subdomain instead of the slug
      --local      force local expose (<slug>.yeksax.dev) even if logged in
      --hosted     force hosted snapshot even if a local default is set
  lattice unshare <slug> [--local|--hosted]   stop sharing (poll data is kept)
  lattice shares                     list active shares + vote counts
  lattice results <slug> [--local|--hosted]   dump poll submissions

Once logged in, share/unshare/results default to hosted (stays up with your
laptop closed). Without a token they use local expose.

env: LATTICE_ADDR (default 127.0.0.1:4600), LATTICE_DIR (default ~/.summaries),
     LATTICE_API_BASE (override hosted API base)`

func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		fmt.Println(usage)
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "serve":
		err = runServe()
	case "add":
		fs := flag.NewFlagSet("add", flag.ExitOnError)
		title := fs.String("title", "", "override title")
		tags := fs.String("tags", "", "comma-separated tags")
		noOpen := fs.Bool("no-open", false, "don't open the browser")
		fs.Parse(reorderFlags(os.Args[2:], "title", "tags"))
		if fs.NArg() != 1 {
			err = fmt.Errorf("usage: lattice add <file.html> [--title t] [--tags a,b] [--no-open]")
			break
		}
		var tagList []string
		for _, t := range strings.Split(*tags, ",") {
			if t = strings.TrimSpace(t); t != "" {
				tagList = append(tagList, t)
			}
		}
		err = cliAdd(fs.Arg(0), *title, tagList, *noOpen)
	case "ls", "list":
		err = cliLs()
	case "rm", "remove":
		if len(os.Args) != 3 {
			err = fmt.Errorf("usage: lattice rm <slug>")
			break
		}
		err = cliRm(os.Args[2])
	case "open":
		slug := ""
		if len(os.Args) > 2 {
			slug = os.Args[2]
		}
		err = cliOpen(slug)
	case "login":
		fs := flag.NewFlagSet("login", flag.ExitOnError)
		api := fs.String("api", "", "override the hosted API base URL")
		fs.Parse(reorderFlags(os.Args[2:], "api"))
		if fs.NArg() != 1 {
			err = fmt.Errorf("usage: lattice login <token> [--api url]")
			break
		}
		err = cliLogin(fs.Arg(0), *api)
	case "logout":
		err = cliLogout()
	case "share":
		fs := flag.NewFlagSet("share", flag.ExitOnError)
		random := fs.Bool("random", false, "use a random 8-char subdomain")
		local := fs.Bool("local", false, "force local expose")
		hosted := fs.Bool("hosted", false, "force hosted snapshot")
		fs.Parse(reorderFlags(os.Args[2:]))
		if fs.NArg() != 1 {
			err = fmt.Errorf("usage: lattice share <slug> [--random] [--local|--hosted]")
			break
		}
		if useHosted(*hosted, *local) {
			err = hostedShare(fs.Arg(0), *random)
		} else {
			err = cliShare(fs.Arg(0), *random)
		}
	case "unshare":
		fs := flag.NewFlagSet("unshare", flag.ExitOnError)
		local := fs.Bool("local", false, "target a local expose share")
		hosted := fs.Bool("hosted", false, "target a hosted share")
		fs.Parse(reorderFlags(os.Args[2:]))
		if fs.NArg() != 1 {
			err = fmt.Errorf("usage: lattice unshare <slug> [--local|--hosted]")
			break
		}
		if useHosted(*hosted, *local) {
			err = hostedUnshare(fs.Arg(0))
		} else {
			err = cliUnshare(fs.Arg(0))
		}
	case "shares":
		err = cliShares()
	case "results":
		fs := flag.NewFlagSet("results", flag.ExitOnError)
		local := fs.Bool("local", false, "target a local expose share")
		hosted := fs.Bool("hosted", false, "target a hosted share")
		fs.Parse(reorderFlags(os.Args[2:]))
		if fs.NArg() != 1 {
			err = fmt.Errorf("usage: lattice results <slug> [--local|--hosted]")
			break
		}
		if useHosted(*hosted, *local) {
			err = hostedResults(fs.Arg(0))
		} else {
			err = cliResults(fs.Arg(0))
		}
	case "help", "-h", "--help":
		fmt.Println(usage)
	default:
		fmt.Println(usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "lattice:", err)
		os.Exit(1)
	}
}

// reorderFlags lets flags appear after positionals (stdlib flag stops at the
// first non-flag arg). valueFlags are names that consume the next argument.
func reorderFlags(args []string, valueFlags ...string) []string {
	takesValue := func(a string) bool {
		name := strings.TrimLeft(a, "-")
		for _, v := range valueFlags {
			if name == v {
				return true
			}
		}
		return false
	}
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") {
			flags = append(flags, a)
			if !strings.Contains(a, "=") && takesValue(a) && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		} else {
			pos = append(pos, a)
		}
	}
	return append(flags, pos...)
}

func runServe() error {
	if err := ensureDirs(); err != nil {
		return err
	}
	ix := newIndex()
	// Scan in the background: reading a summary whose target sits in a
	// TCC-protected dir (~/Downloads etc.) can block on the macOS permission
	// prompt when running under launchd - the server must come up regardless.
	go func() {
		ix.scan()
		ix.watch()
	}()

	pollJS, _ := dashboardFS.ReadFile("dashboard/poll.js")
	sm := newShareManager(string(pollJS))
	sm.load()

	srv := newServer(ix, sm)
	h := srv.handler()

	// Pretty-hostname alias: browsers resolve *.localhost to loopback on their
	// own, so http://summaries.localhost works once something answers on :80.
	// Best-effort - if the port is busy, the main listener still serves.
	if alias := aliasAddr(); alias != "off" {
		go func() {
			if err := http.ListenAndServe(alias, loopbackOnly(h)); err != nil {
				log.Printf("alias listener %s unavailable (summaries.localhost disabled): %v", alias, err)
			}
		}()
		log.Printf("alias http://summaries.localhost (%s, loopback-only)", alias)
	}

	log.Printf("lattice serving %s on http://%s", summariesDir(), listenAddr())
	return http.ListenAndServe(listenAddr(), h)
}

func aliasAddr() string {
	if a := os.Getenv("LATTICE_ALIAS_ADDR"); a != "" {
		return a // set to "off" to disable
	}
	return ":80"
}
