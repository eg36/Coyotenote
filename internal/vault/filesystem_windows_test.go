//go:build windows

package vault

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestRenameReplaceRetriesSharingViolation(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "note.md")
	source := filepath.Join(dir, ".pending-test")
	for path, body := range map[string]string{target: "original", source: "replacement"} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	name, err := windows.UTF16PtrFromString(target)
	if err != nil {
		t.Fatal(err)
	}
	// Omit FILE_SHARE_DELETE to emulate an antivirus holding the destination.
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	released := make(chan error, 1)
	go func() {
		time.Sleep(50 * time.Millisecond)
		released <- windows.CloseHandle(handle)
	}()
	err = renameReplace(source, target)
	if closeErr := <-released; closeErr != nil {
		t.Fatal(closeErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(target)
	if err != nil || string(body) != "replacement" {
		t.Fatalf("replacement: %q, %v", body, err)
	}
}
