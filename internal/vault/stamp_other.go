//go:build !linux && !darwin && !freebsd && !netbsd

package vault

import (
	"io/fs"
	"time"
)

// changeStamp is unavailable here, so load relies on size and modification time.
func changeStamp(fs.FileInfo) (uint64, time.Time) { return 0, time.Time{} }
