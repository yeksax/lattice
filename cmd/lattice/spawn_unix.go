//go:build !windows

package main

// spawn_daemon_unix.go - detach `lattice serve` into its own session so it
// outlives the CLI process that spawned it. Output goes to the daemon log.

import (
	"os"
	"os/exec"
	"syscall"
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
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		logf.Close()
		return err
	}
	go func() {
		cmd.Wait() // reap the (short-lived) leader once it detaches/exits
		logf.Close()
	}()
	return nil
}
