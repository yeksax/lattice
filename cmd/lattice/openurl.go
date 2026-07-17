package main

// openurl.go - cross-platform "open this URL in the default browser".
// darwin: open(1); windows: rundll32 url.dll; everything else: xdg-open.

import (
	"os"
	"os/exec"
	"runtime"
)

func openInBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}
