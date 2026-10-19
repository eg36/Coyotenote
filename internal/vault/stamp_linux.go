//go:build linux

package vault

import (
	"io/fs"
	"syscall"
	"time"
)

// changeStamp is the file's inode and status change time. Writing a file
// changes both or the change time, even when the writer restores the
// modification time afterwards.
func changeStamp(info fs.FileInfo) (uint64, time.Time) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, time.Time{}
	}
	return uint64(st.Ino), time.Unix(st.Ctim.Unix())
}
