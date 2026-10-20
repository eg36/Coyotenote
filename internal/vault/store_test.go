package vault

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func writeNote(t *testing.T, s *Store, id, body string) {
	t.Helper()
	p := s.Path(id)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}

func ids(notes []Note) string {
	var out []string
	for _, n := range notes {
		out = append(out, n.ID)
	}
	return strings.Join(out, ",")
}

func assertFileBody(t *testing.T, path, want string) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil || string(b) != want {
		t.Fatalf("%s: got %q, want %q: %v", path, b, want, err)
	}
}

func TestLoadWalksFoldersAndSkipsHidden(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Plan", "plan")
	// Folder names differ by more than case: Windows folders ignore case.
	writeNote(t, s, "workshop/deep/Inner", "inner")
	writeNote(t, s, "Zebra", "z")
	writeNote(t, s, "apple", "a")
	for _, hidden := range []string{".app-settings/config.md", ".trash/old.md", ".git/x.md"} {
		p := filepath.Join(s.Dir, filepath.FromSlash(hidden))
		os.MkdirAll(filepath.Dir(p), 0700)
		os.WriteFile(p, []byte("hidden"), 0600)
	}
	os.WriteFile(filepath.Join(s.Dir, "Work", ".pending-1"), nil, 0600)
	if runtime.GOOS != "windows" {
		if err := os.Symlink(t.TempDir(), filepath.Join(s.Dir, "linked")); err != nil {
			t.Fatal(err)
		}
	}
	notes, report, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(notes); got != "apple,Work/Plan,workshop/deep/Inner,Zebra" {
		t.Fatal(got)
	}
	if report.Orphans != 1 {
		t.Fatal("pending file in a folder not reported")
	}
}

func TestNameValidation(t *testing.T) {
	for _, good := range []string{"Note", "Work/Project X", "Zażółć gęślą", "a.b"} {
		if err := CheckName(good); err != nil {
			t.Errorf("%q: %v", good, err)
		}
	}
	for _, bad := range []string{"", "/x", "x/", "a//b", "../x", "Work/../x", ".hidden", "a/.b", "a\\b", "CON", "nul.txt", "a:b", "x?", "[[x]]", "a#b", "a|b", "a^b", " x", "x ", "end."} {
		if CheckName(bad) == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestLoadSeesOutsideWritesThatKeepSizeAndTime(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Cached", "AAAA")
	p := s.Path("Cached")
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(p, old, old); err != nil {
		t.Fatal(err)
	}
	load := func() string {
		t.Helper()
		notes, _, err := s.Load()
		if err != nil || len(notes) != 1 {
			t.Fatalf("load: %v %v", notes, err)
		}
		return notes[0].Body
	}
	rewrite := func(body string) {
		t.Helper()
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(p, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.Chtimes(p, info.ModTime(), info.ModTime()); err != nil {
			t.Fatal(err)
		}
	}
	// A file changed just before it was read is read again, whatever the platform.
	load()
	rewrite("BBBB")
	if got := load(); got != "BBBB" {
		t.Fatalf("recent outside write missed: %q", got)
	}
	if inode, changed := changeStamp(mustStat(t, p)); inode == 0 && changed.IsZero() {
		t.Skip("no change stamp on this platform")
	}
	// Older files are trusted by their stamp, which a restored time does not fool.
	defer func(w time.Duration) { racyWindow = w }(racyWindow)
	racyWindow = 0
	load()
	rewrite("CCCC")
	if got := load(); got != "CCCC" {
		t.Fatalf("outside write with restored time missed: %q", got)
	}
}

func mustStat(t *testing.T, p string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func TestOversizedNotesAreSkippedWithoutReadingThem(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Small", "fine")
	big := s.Path("Huge")
	if err := os.WriteFile(big, []byte("start of a huge note"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(big, MaxNoteBytes+1); err != nil {
		t.Fatal(err)
	}
	notes, report, err := s.Load()
	if err != nil || ids(notes) != "Small" || len(report.Skipped) != 1 || report.Skipped[0] != "Huge.md (over 4 MiB)" {
		t.Fatalf("notes %s, skipped %v, %v", ids(notes), report.Skipped, err)
	}
	// In the trash it keeps an excerpt but cannot come back.
	trash := filepath.Join(s.Dir, ".trash")
	os.MkdirAll(trash, 0700)
	if err := os.Rename(big, filepath.Join(trash, "Huge.md")); err != nil {
		t.Fatal(err)
	}
	list, err := s.Trashed()
	if err != nil || len(list) != 1 || list[0].Excerpt != "start of a huge note" {
		t.Fatalf("trash %v, %v", list, err)
	}
	if _, err := s.Restore("Huge", "Huge"); err == nil || !strings.Contains(err.Error(), "over 4 MiB") {
		t.Fatalf("restore: %v", err)
	}
	if _, err := os.Stat(filepath.Join(trash, "Huge.md")); err != nil {
		t.Fatal("oversized note left the trash")
	}
}
