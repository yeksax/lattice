//go:build windows

package main

// spawn_daemon_windows.go - detach `lattice serve` so it outlives the CLI
// process. DETACHED_PROCESS gives it no console; CREATE_NEW_PROCESS_GROUP
// keeps it clear of the parent's Ctrl+C handling.

import (
	"os"
	"os/exec"
	"syscall"
)

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

func spawnDaemon() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := ensureDirs(); err != nil {
		return err
	}
	logf, err := os.OpenFile(daemonLogFile(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "serve")
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
	if err := cmd.Start(); err != nil {
		logf.Close()
		return err
	}
	go func() {
		cmd.Wait()
		logf.Close()
	}()
	return nil
}
