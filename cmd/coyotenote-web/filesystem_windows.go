//go:build windows

package main

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"time"
)

// Retry transient scanner locks without deleting the existing destination.
func renameReplace(old, new string) error {
	var err error
	for attempt := 0; attempt <= 5; attempt++ {
		err = os.Rename(old, new)
		if err == nil || (!errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION)) || attempt == 5 {
			return err
		}
		time.Sleep(20 * time.Millisecond << attempt)
	}
	return err
}

// Windows cannot fsync directory handles; the file itself is synced before rename.
func syncDir(string) error { return nil }
