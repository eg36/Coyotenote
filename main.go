package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "coyotenote:", err)
		os.Exit(1)
	}
}
func run() error {
	dir := flag.String("data-dir", "", "override the standard application data directory")
	flag.Parse()
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
	if final != nil {
		if e := final.(*model).flush(); e != nil {
			return e
		}
	}
	return err
}
