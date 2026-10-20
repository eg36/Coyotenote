package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/eg36/labradorite/internal/vault"
	"github.com/eg36/labradorite/internal/version"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "labradorite:", err)
		os.Exit(1)
	}
}

func run() error {
	listen := flag.String("listen", "127.0.0.1:4280", "loopback address for the local web app")
	dir := flag.String("data-dir", "", "isolated notes/settings directory (default: labradorite in application data)")
	showVersion := flag.Bool("version", false, "print version and exit")
	noBrowser := flag.Bool("no-browser", false, "do not open the app in a browser on start")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "usage: labradorite [flags] [vault]\n\nOpens a folder of Markdown notes in your browser, served only to this computer.")
		flag.PrintDefaults()
	}
	flag.Parse()
	if *showVersion {
		fmt.Println("labradorite", version.String())
		return nil
	}
	if flag.NArg() > 1 || flag.NArg() == 1 && *dir != "" {
		return errors.New("give one vault path or -data-dir, not both")
	}
	config, err := vault.DataDir()
	if err != nil {
		return err
	}
	// Labradorite was called coyotenote, whose web app kept its notes and
	// settings in coyotenote-web. That folder moves over once.
	former := filepath.Join(filepath.Dir(config), "coyotenote-web")
	if *dir == "" {
		if moved, err := moveFormerData(former, config); moved {
			fmt.Printf("Moved your notes from %s to %s\n", former, config)
		} else if err != nil {
			fmt.Printf("Keeping your notes in %s: %v\n", former, err)
			config = former
		}
	}
	vaultDir := flag.Arg(0)
	if vaultDir == "" {
		vaultDir = *dir
	}
	if vaultDir == "" {
		vaultDir = config
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("labradorite must listen on a loopback address, such as 127.0.0.1:4280")
	}
	// Only the default notebook, created on this run, gets a welcome note;
	// folders given on the command line are left as they are.
	fresh := flag.NArg() == 0 && *dir == "" && firstRun(vaultDir)
	s, err := vault.Open(vaultDir)
	if err != nil {
		return err
	}
	defer s.Close()
	if fresh {
		if err := welcome(s); err != nil {
			fmt.Printf("Could not write the welcome note: %v\n", err)
		}
	}
	if *dir != "" {
		config = *dir
	}
	if err = os.MkdirAll(config, 0700); err != nil {
		return err
	}
	s.Config = config
	app, err := newWebApp(s)
	if err != nil {
		return err
	}
	app.formerIDs = formerVaultIDs(*dir, vaultDir, config, former)
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return fmt.Errorf("%w; is Labradorite already running? Choose another address with -listen", err)
	}
	app.port = listener.Addr().(*net.TCPAddr).Port
	server := &http.Server{Handler: app, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	registerTermination(stop)
	done := make(chan struct{})
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		select {
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := server.Shutdown(shutdown); err != nil {
				_ = server.Close()
			}
		case <-done:
		}
	}()
	fmt.Printf("labradorite %s\nOpen http://%s\nVault: %s\nPress Ctrl+C to stop.\n", version.String(), listener.Addr(), s.Dir)
	if !*noBrowser {
		openBrowser("http://" + listener.Addr().String())
	}
	err = server.Serve(listener)
	close(done)
	<-shutdownDone
	// Wait for any handler finishing after a forced connection close before
	// releasing the vault lock.
	app.mu.Lock()
	app.mu.Unlock()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// moveFormerData moves the former data folder to its new name, unless the
// new one exists already or there is nothing to move. A coyotenote still
// running on the former folder keeps it where it is.
func moveFormerData(from, to string) (bool, error) {
	if _, err := os.Lstat(to); err == nil {
		return false, nil
	}
	if info, err := os.Lstat(from); err != nil || !info.IsDir() {
		return false, nil
	}
	old, err := vault.Open(from)
	if err != nil {
		return false, fmt.Errorf("stop coyotenote first so it can move: %w", err)
	}
	old.Close()
	if err := os.MkdirAll(filepath.Dir(to), 0700); err != nil {
		return false, err
	}
	if err := os.Rename(from, to); err != nil {
		return false, err
	}
	return true, nil
}

// formerVaultIDs names the IDs whose browser drafts and settings belong to
// this vault. Drafts are filed under a vault's ID, which follows its path, so
// only the default notebook, whose folder moved from the former app's, has
// one. A -data-dir folder, or any other folder, is its own vault and
// inherits nothing.
func formerVaultIDs(dataDir, vaultDir, config, former string) []string {
	if dataDir != "" || !same(vaultDir, config) || same(config, former) {
		return nil
	}
	return []string{vaultID(former)}
}

func same(a, b string) bool {
	a, errA := filepath.Abs(a)
	b, errB := filepath.Abs(b)
	return errA == nil && errB == nil && a == b
}
