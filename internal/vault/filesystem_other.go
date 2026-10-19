//go:build !windows

package vault

import "os"

func renameReplace(old, new string) error { return os.Rename(old, new) }
func syncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
