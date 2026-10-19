package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/eg36/coyotenote/internal/vault"
	"github.com/eg36/coyotenote/internal/version"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "coyotenote:", err)
		os.Exit(1)
	}
}
func run() error {
	dir := flag.String("data-dir", "", "data directory holding the notes and settings such as the theme")
	showVersion := flag.Bool("version", false, "print the version and exit")
	migrateNames := flag.Bool("migrate", false, "rename notes with timestamp names after their titles, then exit")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "usage: coyotenote [flags] [vault]")
		fmt.Fprintln(flag.CommandLine.Output(), "\nThe vault is a folder of Markdown notes; it defaults to the application data directory.")
		flag.PrintDefaults()
	}
	flag.Parse()
	if *showVersion {
		fmt.Println("coyotenote", version.String())
		return nil
	}
	switch {
	case flag.NArg() > 1:
		return fmt.Errorf("unexpected arguments; use -help")
	case flag.NArg() == 1 && *dir != "":
		return fmt.Errorf("give the vault either as an argument or with -data-dir, not both")
	}
	vaultDir := flag.Arg(0)
	if vaultDir != "" {
		*dir = vaultDir
	}
	config, configErr := vault.DataDir()
	if *dir == "" {
		if configErr != nil {
			return configErr
		}
		*dir = config
	}
	s, err := vault.Open(*dir)
	if err != nil {
		return err
	}
	defer s.Close()
	// A vault argument keeps the theme in the data directory, not among the notes.
	if vaultDir != "" && configErr == nil && !sameDir(config, *dir) && os.MkdirAll(config, 0700) == nil {
		s.Config = config
	}
	if *migrateNames {
		return migrate(s, os.Stdin, os.Stdout)
	}
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

func sameDir(a, b string) bool {
	x, err1 := os.Stat(a)
	y, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(x, y)
}
