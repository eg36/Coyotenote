//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fakeClipboardHelpers(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	data := filepath.Join(dir, "clipboard")
	t.Setenv("SSH_CONNECTION", "")
	t.Setenv("SSH_TTY", "")
	t.Setenv("WAYLAND_DISPLAY", "test")
	t.Setenv("DISPLAY", "")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("COYOTENOTE_TEST_CLIPBOARD", data)
	for name, body := range map[string]string{
		"wl-copy":  "#!/bin/sh\ncat > \"$COYOTENOTE_TEST_CLIPBOARD\"\n",
		"wl-paste": "#!/bin/sh\ncat \"$COYOTENOTE_TEST_CLIPBOARD\"\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	return dir, data
}
func TestLinuxClipboardHelpersPreserveTextAndBoundReads(t *testing.T) {
	_, data := fakeClipboardHelpers(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	clipboard := desktopClipboard{}
	text := "  Zażółć 👩‍💻\n\nlast\n"
	if err := clipboard.Write(ctx, text); err != nil {
		t.Fatal(err)
	}
	result, err := clipboard.Read(ctx)
	if err != nil || result != text {
		t.Fatalf("%q %v", result, err)
	}
	if err := os.WriteFile(data, []byte(strings.Repeat("x", maxPasteBytes+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := clipboard.Read(ctx); err == nil {
		t.Fatal("unbounded clipboard read")
	}
}
func TestLinuxClipboardTimeoutAndUnavailable(t *testing.T) {
	dir, _ := fakeClipboardHelpers(t)
	if err := os.WriteFile(filepath.Join(dir, "wl-paste"), []byte("#!/bin/sh\nexec sleep 10\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := (desktopClipboard{}).Read(ctx); err == nil {
		t.Fatal("helper did not time out")
	}
	t.Setenv("SSH_CONNECTION", "test")
	if _, err := (desktopClipboard{}).Read(context.Background()); err == nil || !strings.Contains(err.Error(), "SSH") {
		t.Fatal(err)
	}
}
func TestLinuxClipboardEmptyIsNotAnError(t *testing.T) {
	dir, _ := fakeClipboardHelpers(t)
	for _, message := range []string{"Nothing is copied", "No selection", "Error: target STRING not available"} {
		script := "#!/bin/sh\necho '" + message + "' >&2\nexit 1\n"
		if err := os.WriteFile(filepath.Join(dir, "wl-paste"), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		if text, err := (desktopClipboard{}).Read(context.Background()); err != nil || text != "" {
			t.Fatalf("%s: %q %v", message, text, err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "wl-paste"), []byte("#!/bin/sh\necho 'broken' >&2\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := (desktopClipboard{}).Read(context.Background()); err == nil {
		t.Fatal("helper failure reported as empty clipboard")
	}
}
