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
)

// The editor holds at most maxLines lines (a Bubbles textarea limit). Pastes are
// also capped at maxPasteBytes so a stray clipboard dump cannot stall the UI.
const (
	maxLines      = 10000
	maxPasteBytes = 1 << 20
)

type note struct{ ID, Body string }

// loadReport describes files that load() left alone for the user to inspect.
type loadReport struct {
	orphans, recoveries int
	skipped             []string
}
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
	if err = lockFile(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("notes are open in another coyotenote instance: %w", err)
	}
	return &store{dir, f}, nil
}
func (s *store) close() { _ = unlockFile(s.lock); _ = s.lock.Close() }

// load reads every note it can. Files that are unsafe to edit (symlinks, invalid
// UTF-8, too many lines, unreadable) are skipped and reported, never changed.
func (s *store) load() ([]note, loadReport, error) {
	var r loadReport
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, r, err
	}
	var notes []note
	for _, e := range entries {
		name := e.Name()
		switch {
		case strings.HasPrefix(name, ".pending-"):
			r.orphans++
			continue
		case strings.HasPrefix(name, ".recovery-"):
			r.recoveries++
			continue
		case strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".md") || e.IsDir():
			continue
		case e.Type()&os.ModeSymlink != 0 || !e.Type().IsRegular():
			r.skipped = append(r.skipped, name+" (not a regular file)")
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, name))
		switch {
		case err != nil:
			r.skipped = append(r.skipped, name+" (unreadable)")
		case !utf8.Valid(b):
			r.skipped = append(r.skipped, name+" (not UTF-8)")
		case strings.Count(string(b), "\n") >= maxLines:
			r.skipped = append(r.skipped, fmt.Sprintf("%s (%d+ lines)", name, maxLines))
		default:
			notes = append(notes, note{strings.TrimSuffix(name, ".md"), string(b)})
		}
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].ID < notes[j].ID })
	return notes, r, nil
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

// writeRecovery preserves unsaved edits beside the notes, or in the system
// temporary directory when the data directory itself cannot be written.
func (s *store) writeRecovery(n note, body string) (string, error) {
	name := fmt.Sprintf(".recovery-%s-%s.md", n.ID, time.Now().UTC().Format("20060102T150405"))
	err := atomicWrite(s.dir, name, []byte(body))
	if err == nil {
		return filepath.Join(s.dir, name), nil
	}
	// CreateTemp opens exclusively (0600), so a planted symlink cannot redirect it.
	f, e := os.CreateTemp("", "coyotenote-recovery-"+n.ID+"-*.md")
	if e == nil {
		if _, e = f.Write([]byte(body)); e == nil {
			e = f.Sync()
		}
		if ce := f.Close(); e == nil {
			e = ce
		}
	}
	if e != nil {
		return "", fmt.Errorf("%v; temporary directory: %v", err, e)
	}
	return f.Name(), nil
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
