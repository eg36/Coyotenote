//go:build !unix

package main

import (
	"errors"
	"os"
)

// Only Linux and macOS are supported; this keeps other platforms compiling.
func lockFile(*os.File) error   { return errors.New("file locking is not supported on this platform") }
func unlockFile(*os.File) error { return nil }
