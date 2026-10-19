package vault

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHistoryKeepsVersionsAndFollowsRenames(t *testing.T) {
	s := testStore(t)
	writeNote(t, s, "Work/Plan", "v3")
	writeNote(t, s, "Work/Plan/Child", "child")
	for _, body := range []string{"v1", "v2"} {
		if err := s.Snapshot("Work/Plan", body); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Snapshot("Work/Plan/Child", "child v1"); err != nil {
		t.Fatal(err)
	}
	versions, err := s.History("Work/Plan")
	if err != nil || len(versions) != 2 || versions[0].ID <= versions[1].ID {
		t.Fatalf("versions %v, %v", versions, err)
	}
	if body, err := s.ReadVersion("Work/Plan", versions[1].ID); err != nil || body != "v1" {
		t.Fatalf("oldest version %q, %v", body, err)
	}
	for _, bad := range []string{"../x", "2026", versions[0].ID + "/../x"} {
		if _, err := s.ReadVersion("Work/Plan", bad); err == nil {
			t.Errorf("read version %q", bad)
		}
	}
	if notes, _, _ := s.Load(); len(notes) != 2 {
		t.Fatalf("versions listed as notes: %v", ids(notes))
	}

	// A rename takes the note's versions along, but not a child note's.
	notes, _, _ := s.Load()
	for _, n := range notes {
		if n.ID == "Work/Plan" {
			if err := s.Rename(n, "Done/Plan"); err != nil {
				t.Fatal(err)
			}
		}
	}
	if moved, _ := s.History("Done/Plan"); len(moved) != 2 {
		t.Fatalf("history did not follow the rename: %v", moved)
	}
	if left, _ := s.History("Work/Plan"); len(left) != 0 {
		t.Fatalf("history left behind: %v", left)
	}
	if child, _ := s.History("Work/Plan/Child"); len(child) != 1 {
		t.Fatalf("child history moved: %v", child)
	}

	// Only the newest MaxVersions are kept.
	for i := 0; i < MaxVersions+5; i++ {
		if err := s.Snapshot("Many", "x"); err != nil {
			t.Fatal(err)
		}
	}
	if many, _ := s.History("Many"); len(many) != MaxVersions {
		t.Fatalf("kept %d versions", len(many))
	}
	entries, _ := os.ReadDir(filepath.Join(s.Dir, ".history", "Many.md"))
	if len(entries) != MaxVersions {
		t.Fatalf("%d files on disk", len(entries))
	}
}
