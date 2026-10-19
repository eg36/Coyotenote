//go:build unix

package main

import (
	"os"
	"os/signal"
	"syscall"
)

func registerTermination(stop func()) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGHUP)
	go func() { <-signals; signal.Stop(signals); stop() }()
}
