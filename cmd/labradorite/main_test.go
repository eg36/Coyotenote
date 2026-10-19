package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/eg36/labradorite/internal/vault"
)

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
