package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

type note struct{ ID, Body string }
type store struct {
	dir  string
	lock *os.File
}

func dataDir() (string, error) {
	if runtime.GOOS == "windows" {
		return "", errors.New("this version supports Linux and macOS")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "coyotenote"), nil
	}
	base := os.Getenv("XDG_DATA_HOME")
	if !filepath.IsAbs(base) {
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "coyotenote"), nil
}
func openStore(dir string) (*store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("notes are open in another coyotenote instance: %w", err)
	}
	return &store{dir, f}, nil
}
func (s *store) close() { _ = unix.Flock(int(s.lock.Fd()), unix.LOCK_UN); _ = s.lock.Close() }
func (s *store) load() ([]note, int, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, 0, err
	}
	var notes []note
	orphans := 0
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".pending-") {
			orphans++
			continue
		}
		if !strings.HasSuffix(e.Name(), ".md") || e.IsDir() {
			continue
		}
		if e.Type()&os.ModeSymlink != 0 {
			return nil, orphans, fmt.Errorf("refusing symlink note %s", e.Name())
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, orphans, err
		}
		if !utf8.Valid(b) || strings.Count(string(b), "\n") >= 10000 {
			return nil, orphans, fmt.Errorf("%s must be UTF-8 and fewer than 10000 lines; file left unchanged", e.Name())
		}
		notes = append(notes, note{strings.TrimSuffix(e.Name(), ".md"), string(b)})
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].ID < notes[j].ID })
	return notes, orphans, nil
}
func atomicWrite(dir, name string, b []byte) error {
	f, err := os.CreateTemp(dir, ".pending-")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		return err
	}
	return syncDir(dir)
}
func syncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func (s *store) create() (note, error) {
	var id [8]byte
	if _, err := rand.Read(id[:]); err != nil {
		return note{}, err
	}
	n := note{ID: time.Now().UTC().Format("20060102T150405.000000000") + "-" + hex.EncodeToString(id[:])}
	return n, atomicWrite(s.dir, n.ID+".md", nil)
}
func (s *store) save(n note, body string) error {
	p := filepath.Join(s.dir, n.ID+".md")
	info, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("note is no longer a regular file")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	if string(b) != n.Body {
		return errors.New("note changed outside coyotenote; copy your edits before restarting")
	}
	return atomicWrite(s.dir, n.ID+".md", []byte(body))
}
func (s *store) remove(n note) error {
	b, err := os.ReadFile(filepath.Join(s.dir, n.ID+".md"))
	if err != nil {
		return err
	}
	if string(b) != n.Body {
		return errors.New("note changed outside coyotenote; restart before deleting")
	}
	if err = os.Remove(filepath.Join(s.dir, n.ID+".md")); err != nil {
		return err
	}
	return syncDir(s.dir)
}
func title(body string) string {
	for _, line := range strings.Split(body, "\n") {
		if t := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#")); t != "" {
			return t
		}
	}
	return "Untitled"
}
