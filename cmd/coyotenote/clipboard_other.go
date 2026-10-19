//go:build !linux && !windows

package main

import (
	"context"
	"errors"
)

type desktopClipboard struct{}

func (desktopClipboard) Read(context.Context) (string, error) {
	return "", errors.New("clipboard unavailable on this platform; use terminal paste")
}
func (desktopClipboard) Write(context.Context, string) error {
	return errors.New("clipboard unavailable on this platform")
}
