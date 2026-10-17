package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrashAndRestoreStore(t *testing.T) {
	s := testStore(t)
	n := note{ID: "a-note", Body: "# Saved\nbody"}
	if err := os.WriteFile(filepath.Join(s.dir, n.ID+".md"), []byte(n.Body), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.trash(n); err != nil {
		t.Fatal(err)
	}
	loaded, report, err := s.load()
	if err != nil || len(loaded) != 0 || len(report.skipped) != 0 {
		t.Fatalf("trash appeared in notebook: %v %v %v", loaded, report, err)
	}
	got, err := s.restore(n.ID)
	if err != nil || got != n {
		t.Fatalf("restore: %+v %v", got, err)
	}
	if _, err = os.Lstat(filepath.Join(s.dir, ".trash", n.ID+".md")); !os.IsNotExist(err) {
		t.Fatalf("trash source remains: %v", err)
	}
}

func TestTrashRefusesChangedAndCollidingNotes(t *testing.T) {
	s := testStore(t)
	n := note{ID: "a-note", Body: "original"}
	source := filepath.Join(s.dir, n.ID+".md")
	if err := os.WriteFile(source, []byte("external edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.trash(n); err == nil {
		t.Fatal("trashed changed note")
	}
	assertFileBody(t, source, "external edit")
	n.Body = "external edit"
	dir, err := s.trashDirectory(true)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, n.ID+".md")
	if err = os.WriteFile(destination, []byte("earlier deletion"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = s.trash(n); err == nil {
		t.Fatal("overwrote trash collision")
	}
	assertFileBody(t, source, n.Body)
	assertFileBody(t, destination, "earlier deletion")
}

func TestRestoreRefusesExistingAndInvalidFiles(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		existing   bool
	}{
		{"existing", "saved", true},
		{"invalid UTF-8", string([]byte{0xff}), false},
		{"too many lines", strings.Repeat("\n", maxLines), false},
		{"too many CR lines", strings.Repeat("\r", maxLines), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := testStore(t)
			dir, err := s.trashDirectory(true)
			if err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(dir, "a-note.md")
			if err = os.WriteFile(source, []byte(tc.body), 0600); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(s.dir, "a-note.md")
			if tc.existing {
				if err = os.WriteFile(destination, []byte("existing"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = s.restore("a-note"); err == nil {
				t.Fatal("restored unsafe or conflicting note")
			}
			assertFileBody(t, source, tc.body)
			if tc.existing {
				assertFileBody(t, destination, "existing")
			} else if _, err = os.Lstat(destination); !os.IsNotExist(err) {
				t.Fatalf("invalid note moved: %v", err)
			}
		})
	}
}

func TestTrashRefusesSymlinks(t *testing.T) {
	s := testStore(t)
	external := filepath.Join(t.TempDir(), "external.md")
	if err := os.WriteFile(external, []byte("precious"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(s.dir, "linked.md")
	if err := os.Symlink(external, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := s.trash(note{ID: "linked", Body: "precious"}); err == nil {
		t.Fatal("trashed symlink")
	}
	assertFileBody(t, external, "precious")
	if err := os.Symlink(filepath.Dir(external), filepath.Join(s.dir, ".trash")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.trashDirectory(true); err == nil {
		t.Fatal("accepted symlink trash directory")
	}
}

func assertFileBody(t *testing.T, path, want string) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil || string(b) != want {
		t.Fatalf("%s: got %q, want %q: %v", path, b, want, err)
	}
}
