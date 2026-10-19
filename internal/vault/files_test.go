package vault

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveFileReadsNoteFolderThenVaultRoot(t *testing.T) {
	s := testStore(t)
	for _, rel := range []string{"attachments/a.png", "Trip/photo.png", "photo.png", ".trash/hidden.png"} {
		p := filepath.Join(s.Dir, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0700)
		os.WriteFile(p, []byte("x"), 0600)
	}
	for _, tc := range []struct{ src, from, want string }{
		{"photo.png", "Trip/Lisbon", "Trip/photo.png"},
		{"photo.png", "Home", "photo.png"},
		{"attachments/a.png", "Trip/Lisbon", "attachments/a.png"},
		{"../attachments/a.png", "Trip/Lisbon", "attachments/a.png"},
		{"/attachments/a.png", "Trip/Lisbon", "attachments/a.png"},
	} {
		if got, ok := s.ResolveFile(tc.src, tc.from); !ok || got != tc.want {
			t.Errorf("%s from %s: got %q %v", tc.src, tc.from, got, ok)
		}
	}
	for _, bad := range []string{"../outside.png", "../../etc/passwd", ".trash/hidden.png", "missing.png", "https://example.com/x.png", ""} {
		if got, ok := s.ResolveFile(bad, "Trip/Lisbon"); ok {
			t.Errorf("%s resolved to %q", bad, got)
		}
	}
	if got, ok := s.FindFile("A.PNG"); !ok || got != "attachments/a.png" {
		t.Errorf("find by name: %q", got)
	}
	if got, ok := s.FindFile("photo.png"); !ok || got != "photo.png" {
		t.Errorf("shortest path should win: %q", got)
	}
	if _, ok := s.FindFile("hidden.png"); ok {
		t.Error("found a file in a hidden folder")
	}
	if runtime.GOOS != "windows" {
		outside := filepath.Join(t.TempDir(), "secret.png")
		os.WriteFile(outside, []byte("secret"), 0600)
		os.Symlink(outside, filepath.Join(s.Dir, "link.png"))
		os.Symlink(filepath.Dir(outside), filepath.Join(s.Dir, "linked"))
		for _, src := range []string{"link.png", "linked/secret.png"} {
			if _, ok := s.ResolveFile(src, ""); ok {
				t.Errorf("followed symlink %s", src)
			}
			if f, err := s.OpenFile(src); err == nil {
				f.Close()
				t.Errorf("opened symlink %s", src)
			}
		}
	}
}

func TestSaveAttachmentChoosesFreePortableNames(t *testing.T) {
	s := testStore(t)
	for _, tc := range []struct{ name, want string }{
		{"My Photo (1).PNG", "attachments/My-Photo-1.png"},
		{"My Photo (1).png", "attachments/My-Photo-1-2.png"},
		{"../../evil.jpg", "attachments/evil.jpg"},
		{"CON.gif", "attachments/image.gif"},
		{"日本.webp", "attachments/日本.webp"},
	} {
		got, err := s.SaveAttachment(tc.name, []byte("data"))
		if err != nil || got != tc.want {
			t.Errorf("%q: got %q, %v", tc.name, got, err)
		}
	}
	assertFileBody(t, filepath.Join(s.Dir, "attachments", "My-Photo-1.png"), "data")
	if _, err := s.SaveAttachment("notes.md", []byte("x")); err == nil {
		t.Error("saved a non-image")
	}
	if notes, _, _ := s.Load(); len(notes) != 0 {
		t.Errorf("attachments listed as notes: %v", ids(notes))
	}
}
