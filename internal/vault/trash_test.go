package vault

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrashAndRestoreStore(t *testing.T) {
	s := testStore(t)
	n := Note{ID: "a-note", Body: "# Saved\nbody"}
	if err := os.WriteFile(filepath.Join(s.Dir, n.ID+".md"), []byte(n.Body), 0600); err != nil {
		t.Fatal(err)
	}
	if id, err := s.Trash(n); err != nil || id != n.ID {
		t.Fatal(id, err)
	}
	loaded, report, err := s.Load()
	if err != nil || len(loaded) != 0 || len(report.Skipped) != 0 {
		t.Fatalf("trash appeared in notebook: %v %v %v", loaded, report, err)
	}
	got, err := s.Restore(n.ID, n.ID)
	if err != nil || got != n {
		t.Fatalf("restore: %+v %v", got, err)
	}
	if _, err = os.Lstat(filepath.Join(s.Dir, ".trash", n.ID+".md")); !os.IsNotExist(err) {
		t.Fatalf("trash source remains: %v", err)
	}
}

func TestTrashRefusesChangedNotesAndKeepsEarlierDeletions(t *testing.T) {
	s := testStore(t)
	n := Note{ID: "a-note", Body: "original"}
	source := filepath.Join(s.Dir, n.ID+".md")
	if err := os.WriteFile(source, []byte("external edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Trash(n); err == nil {
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
	id, err := s.Trash(n)
	if err != nil || id != "a-note 2" {
		t.Fatal(id, err)
	}
	assertFileBody(t, destination, "earlier deletion")
	assertFileBody(t, filepath.Join(dir, "a-note 2.md"), n.Body)
}

func TestRestoreRefusesExistingAndInvalidFiles(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		existing   bool
	}{
		{"existing", "saved", true},
		{"invalid UTF-8", string([]byte{0xff}), false},
		{"too many lines", strings.Repeat("\n", MaxLines), false},
		{"too many CR lines", strings.Repeat("\r", MaxLines), false},
		{"control characters", "bell\a", false},
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
			destination := filepath.Join(s.Dir, "a-note.md")
			if tc.existing {
				if err = os.WriteFile(destination, []byte("existing"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = s.Restore("a-note", "a-note"); err == nil {
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
	link := filepath.Join(s.Dir, "linked.md")
	if err := os.Symlink(external, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := s.Trash(Note{ID: "linked", Body: "precious"}); err == nil {
		t.Fatal("trashed symlink")
	}
	assertFileBody(t, external, "precious")
	if err := os.Symlink(filepath.Dir(external), filepath.Join(s.Dir, ".trash")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.trashDirectory(true); err == nil {
		t.Fatal("accepted symlink trash directory")
	}
}

func TestTrashKeepsFolders(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Deep/N", "body")
	n := Note{ID: "Work/Deep/N", Body: "body"}
	if _, err := s.Trash(n); err != nil {
		t.Fatal(err)
	}
	assertFileBody(t, filepath.Join(s.Dir, ".trash", "Work", "Deep", "N.md"), "body")
	os.RemoveAll(filepath.Join(s.Dir, "Work"))
	got, err := s.Restore(n.ID, n.ID)
	if err != nil || got != n {
		t.Fatal(got, err)
	}
	assertFileBody(t, s.Path(n.ID), "body")
}
