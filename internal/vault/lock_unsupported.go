//go:build !unix && !windows

package vault

import (
	"errors"
	"os"
)

// Keep platforms without a supported file lock compiling.
func lockFile(*os.File) error   { return errors.New("file locking is not supported on this platform") }
func unlockFile(*os.File) error { return nil }
