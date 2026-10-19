package vault

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
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
	for _, hidden := range []string{".obsidian/config.md", ".trash/old.md", ".git/x.md"} {
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
