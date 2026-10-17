//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type desktopClipboard struct{}

func clipboardHelper(read bool) (string, []string, error) {
	if os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_TTY") != "" {
		return "", nil, errors.New("desktop clipboard unavailable over SSH; use terminal copy/paste")
	}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		name, args := "wl-copy", []string{"--type", "text/plain;charset=utf-8"}
		if read {
			name, args = "wl-paste", []string{"--no-newline", "--type", "text"}
		}
		if p, err := exec.LookPath(name); err == nil {
			return p, args, nil
		}
	}
	if os.Getenv("DISPLAY") != "" {
		if p, err := exec.LookPath("xclip"); err == nil {
			args := []string{"-selection", "clipboard", "-in"}
			if read {
				args[2] = "-out"
			}
			return p, args, nil
		}
		if p, err := exec.LookPath("xsel"); err == nil {
			action := "--input"
			if read {
				action = "--output"
			}
			return p, []string{"--clipboard", action}, nil
		}
	}
	return "", nil, errors.New("install wl-clipboard (Wayland) or xclip/xsel (X11); terminal paste still works")
}

// Bound captured output as well as helper lifetime; a clipboard dump must not
// allocate arbitrary memory before the editor can enforce its paste limit.
type clipboardBuffer struct{ data bytes.Buffer }

func (b *clipboardBuffer) Write(p []byte) (int, error) {
	if b.data.Len()+len(p) > maxPasteBytes {
		return 0, errors.New("clipboard exceeds 1 MiB")
	}
	return b.data.Write(p)
}
func (desktopClipboard) Read(ctx context.Context) (string, error) {
	name, args, err := clipboardHelper(true)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 200 * time.Millisecond
	var out clipboardBuffer
	cmd.Stdout = &out
	if err = cmd.Run(); err != nil {
		return "", fmt.Errorf("read failed: %w; use terminal paste", err)
	}
	return out.data.String(), nil
}
func (desktopClipboard) Write(ctx context.Context, text string) error {
	name, args, err := clipboardHelper(false)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 200 * time.Millisecond
	cmd.Stdin = strings.NewReader(text)
	if err = cmd.Run(); err != nil {
		return fmt.Errorf("copy failed: %w", err)
	}
	return nil
}
