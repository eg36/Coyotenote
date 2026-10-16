package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
)

// version is set at build time with -ldflags "-X main.version=v1.2.3".
var version = ""

func versionString() string {
	if version != "" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "dev"
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "coyotenote:", err)
		os.Exit(1)
	}
}
func run() error {
	dir := flag.String("data-dir", "", "override the standard application data directory")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println("coyotenote", versionString())
		return nil
	}
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected arguments; use -help")
	}
	if *dir == "" {
		d, err := dataDir()
		if err != nil {
			return err
		}
		*dir = d
	}
	s, err := openStore(*dir)
	if err != nil {
		return err
	}
	defer s.close()
	m, err := newModel(s)
	if err != nil {
		return err
	}
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithoutSignalHandler())
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case <-signals:
				p.Send(exitMsg{})
			case <-done:
				return
			}
		}
	}()
	final, err := p.Run()
	if m, ok := final.(*model); ok {
		if e := m.flush(); e != nil {
			if m.recovery != "" {
				return fmt.Errorf("%w; unsaved edits were copied to %s", e, m.recovery)
			}
			return e
		}
	}
	return err
}
