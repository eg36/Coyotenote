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
	"time"

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
	listen := flag.String("listen", "127.0.0.1:4280", "loopback address for the local web app")
	dir := flag.String("data-dir", "", "isolated notes/settings directory (default: coyotenote-web in application data)")
	showVersion := flag.Bool("version", false, "print version and exit")
	noBrowser := flag.Bool("no-browser", false, "do not open the app in a browser on start")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "usage: coyotenote [flags] [vault]\n\nOpens a folder of Markdown notes in your browser, served only to this computer.")
		flag.PrintDefaults()
	}
	flag.Parse()
	if *showVersion {
		fmt.Println("coyotenote", version.String())
		return nil
	}
	if flag.NArg() > 1 || flag.NArg() == 1 && *dir != "" {
		return errors.New("give one vault path or -data-dir, not both")
	}
	config, err := vault.DataDir()
	if err != nil {
		return err
	}
	// The default vault keeps the name it had beside the terminal app.
	config += "-web"
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
		return errors.New("coyotenote must listen on a loopback address, such as 127.0.0.1:4280")
	}
	s, err := vault.Open(vaultDir)
	if err != nil {
		return err
	}
	defer s.Close()
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
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return fmt.Errorf("%w; is coyotenote already running? Choose another address with -listen", err)
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
	fmt.Printf("coyotenote %s\nOpen http://%s\nVault: %s\nPress Ctrl+C to stop.\n", version.String(), listener.Addr(), s.Dir)
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
