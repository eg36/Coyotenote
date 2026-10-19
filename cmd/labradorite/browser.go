package main

import (
	"os"
	"os/exec"
	"runtime"
)

// openBrowser shows url in the default browser, when this computer has a
// screen to show it on. Failing to open one is not an error: the address is
// printed too.
func openBrowser(url string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", url)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return
		}
		command = exec.Command("xdg-open", url)
	}
	if command.Start() == nil {
		go func() { _ = command.Wait() }()
	}
}
