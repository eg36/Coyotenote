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

func TestMovedFileLinksPreservesWikiEmbeds(t *testing.T) {
	s := testStore(t)
	for _, rel := range []string{"Work/picture.png", "Other/picture.png", "Work/my picture.png", "Other/my picture.png", "Work/picture#1.png", "Other/picture#1.png", "Work/file.pdf", "Other/file.pdf", "Work/talk.mp3", "Other/talk.mp3", "Work/clip.mp4", "Other/clip.mp4", "attachments/shared.png", "Elsewhere/fallback.mp4", "Other/fallback.mp4"} {
		p := filepath.Join(s.Dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(rel), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ body, want string }{
		{"![[picture.png|100x80]]", "![[../Work/picture.png|100x80]]"},
		{"![[my%20picture.png]]", "![[../Work/my%20picture.png]]"},
		{"![[picture%231.png]]", "![[../Work/picture%231.png]]"},
		{"![[file.pdf#page=2|Pages]]", "![[../Work/file.pdf#page=2|Pages]]"},
		{"![[talk.mp3|Talk]] ![[clip.mp4]]", "![[../Work/talk.mp3|Talk]] ![[../Work/clip.mp4]]"},
		{"![[picture.png\\|100]]", "![[../Work/picture.png\\|100]]"},
		{"![[fallback.mp4]]", "![[../Elsewhere/fallback.mp4]]"},
		{"![[attachments/shared.png]] ![[missing.mp4]] ![[Note]]", "![[attachments/shared.png]] ![[missing.mp4]] ![[Note]]"},
		{"`![[clip.mp4]]`\n\n    ![[clip.mp4]]\n\n```\n![[clip.mp4]]\n```\n\\![[clip.mp4]]", "`![[clip.mp4]]`\n\n    ![[clip.mp4]]\n\n```\n![[clip.mp4]]\n```\n\\![[clip.mp4]]"},
		{"![[https://example.com/clip.mp4]]", "![[https://example.com/clip.mp4]]"},
		{"![pic](picture.png) ![[clip.mp4]]", "![pic](../Work/picture.png) ![[../Work/clip.mp4]]"},
	} {
		if got := s.MovedFileLinks(tc.body, "Work/Note", "Other/Note"); got != tc.want {
			t.Errorf("%q: got %q, want %q", tc.body, got, tc.want)
		}
		if got := s.MovedFileLinks(tc.body, "Work/Note", "Work/Renamed"); got != tc.body {
			t.Errorf("same-folder rename changed %q", tc.body)
		}
	}
}
