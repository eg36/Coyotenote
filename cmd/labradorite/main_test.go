package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/eg36/labradorite/internal/vault"
)

func TestOnlyTheDefaultVaultInheritsFormerDrafts(t *testing.T) {
	base := t.TempDir()
	config, former := filepath.Join(base, "labradorite"), filepath.Join(base, "coyotenote-web")
	other := filepath.Join(base, "elsewhere")
	if got := formerVaultIDs("", config, config, former); len(got) != 1 || got[0] != vaultID(former) {
		t.Fatalf("default vault: %v", got)
	}
	for name, ids := range map[string][]string{
		"-data-dir":          formerVaultIDs(other, other, other, former),
		"-data-dir default":  formerVaultIDs(config, config, config, former),
		"vault argument":     formerVaultIDs("", other, config, former),
		"kept former folder": formerVaultIDs("", former, former, former),
	} {
		if len(ids) != 0 {
			t.Errorf("%s inherited %v", name, ids)
		}
	}
}

func TestFormerDataMovesOnceAndNeverOverwrites(t *testing.T) {
	base := t.TempDir()
	from, to := filepath.Join(base, "coyotenote-web"), filepath.Join(base, "labradorite")
	if moved, err := moveFormerData(from, to); moved || err != nil {
		t.Fatalf("nothing to move: %v %v", moved, err)
	}
	os.MkdirAll(from, 0700)
	os.WriteFile(filepath.Join(from, "Note.md"), []byte("kept"), 0600)

	// A coyotenote still running on the folder keeps it in place.
	running, err := vault.Open(from)
	if err != nil {
		t.Fatal(err)
	}
	if moved, err := moveFormerData(from, to); moved || err == nil {
		t.Fatalf("moved a folder in use: %v %v", moved, err)
	}
	running.Close()

	if moved, err := moveFormerData(from, to); !moved || err != nil {
		t.Fatalf("move: %v %v", moved, err)
	}
	if b, err := os.ReadFile(filepath.Join(to, "Note.md")); err != nil || string(b) != "kept" {
		t.Fatalf("moved note: %q %v", b, err)
	}
	// Once the new folder exists, a former folder appearing again stays put.
	os.MkdirAll(from, 0700)
	if moved, err := moveFormerData(from, to); moved || err != nil {
		t.Fatalf("moved over an existing folder: %v %v", moved, err)
	}
}

func TestWelcomeNoteOnlyForANewNotebook(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "labradorite")
	if !firstRun(dir) {
		t.Fatal("a missing folder is a first run")
	}
	s, err := vault.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if firstRun(dir) {
		t.Fatal("an existing folder is not a first run")
	}
	if err = welcome(s); err != nil {
		t.Fatal(err)
	}
	notes, _, err := s.Load()
	if err != nil || len(notes) != 1 || notes[0].ID != welcomeID {
		t.Fatalf("notes %v, %v", notes, err)
	}
	// Examples sit in code, so the note brings no tags or links of its own.
	if tags, links := vault.Tags(notes[0].Body), vault.ParseLinks(notes[0].Body); len(tags) != 0 || len(links) != 0 {
		t.Fatalf("welcome adds tags %v or links %v", tags, links)
	}
	if err = validateBody(notes[0].Body); err != nil {
		t.Fatal(err)
	}
	// A notebook keeps its notes: writing it again never replaces one.
	if err = welcome(s); err == nil {
		t.Fatal("welcome overwrote an existing note")
	}
}
