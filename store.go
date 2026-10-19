package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// The editor holds at most maxLines lines (a Bubbles textarea limit). Pastes are
// also capped at maxPasteBytes so a stray clipboard dump cannot stall the UI.
const (
	maxLines      = 10000
	maxPasteBytes = 1 << 20
)

type note struct {
	ID, Body string
	// Modified is the file's modification time when load read it.
	Modified time.Time
}

// editorText gives the editor LF line endings and reports whether the file used
// CRLF, so saves can restore it. Lone CRs (classic Mac) become LF.
func editorText(body string) (string, bool) {
	crlf := strings.Contains(body, "\r\n")
	return strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n"), crlf
}

// diskText is the file form of editor text.
func diskText(text string, crlf bool) string {
	if crlf {
		return strings.ReplaceAll(text, "\n", "\r\n")
	}
	return text
}

// hasControl reports control characters other than line endings and tabs. The
// editor drops them, so notes holding them are left alone instead of rewritten.
func hasControl(body string) bool {
	return strings.ContainsFunc(body, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t'
	})
}

// lineCount counts lines as the editor will hold them.
func lineCount(body string) int {
	text, _ := editorText(body)
	return strings.Count(text, "\n") + 1
}

// loadReport describes files that load() left alone for the user to inspect.
type loadReport struct {
	orphans, recoveries int
	skipped             []string
}
type store struct {
	dir string
	// config holds user settings such as the theme. It is the vault itself for
	// the default data directory, and the data directory for other vaults.
	config string
	lock   *os.File
	// cache holds what load last read for each note ID, so unchanged files
	// are not read and checked again. Every write through the store forgets
	// the IDs it touches, which keeps file systems with coarse modification
	// times from serving stale text after a quick save of the same size.
	cache map[string]cachedNote
}

type cachedNote struct {
	size     int64
	modified time.Time
	body     string
	skip     string // why load skipped the file; empty for a usable note
}

func (s *store) forget(ids ...string) {
	for _, id := range ids {
		delete(s.cache, id)
	}
}

func dataDir() (string, error) {
	if runtime.GOOS == "windows" {
		base, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(base, "coyotenote"), nil
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
	return &store{dir: dir, config: dir, lock: f}, nil
}
func (s *store) close() { _ = unlockFile(s.lock); _ = s.lock.Close() }

// load reads every note below the vault root, skipping hidden directories
// such as .trash, .git and .obsidian. Files that are unsafe to edit (symlinks,
// invalid UTF-8, too many lines, unreadable) are skipped and reported, never changed.
func (s *store) load() ([]note, loadReport, error) {
	var r loadReport
	var notes []note
	seen := make(map[string]cachedNote, len(s.cache))
	err := filepath.WalkDir(s.dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			if p == s.dir {
				return err
			}
			rel, _ := filepath.Rel(s.dir, p)
			r.skipped = append(r.skipped, filepath.ToSlash(rel)+" (unreadable)")
			return nil
		}
		name := e.Name()
		if p == s.dir {
			return nil
		}
		if e.IsDir() {
			// WalkDir never follows directory symlinks; hidden directories stay private.
			if strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(s.dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		switch {
		case strings.HasPrefix(name, ".pending-"):
			r.orphans++
			return nil
		case strings.HasPrefix(name, ".recovery-"):
			r.recoveries++
			return nil
		case strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".md"):
			return nil
		case e.Type()&os.ModeSymlink != 0 || !e.Type().IsRegular():
			r.skipped = append(r.skipped, rel+" (not a regular file)")
			return nil
		}
		id := strings.TrimSuffix(rel, ".md")
		if !validID(id) {
			r.skipped = append(r.skipped, rel+" (unsupported name)")
			return nil
		}
		info, err := e.Info()
		if err != nil {
			r.skipped = append(r.skipped, rel+" (unreadable)")
			return nil
		}
		c, ok := s.cache[id]
		if !ok || c.size != info.Size() || !c.modified.Equal(info.ModTime()) {
			c = cachedNote{size: info.Size(), modified: info.ModTime()}
			b, err := os.ReadFile(p)
			switch {
			case err != nil:
				c.skip = rel + " (unreadable)"
			case !utf8.Valid(b):
				c.skip = rel + " (not UTF-8)"
			case lineCount(string(b)) > maxLines:
				c.skip = fmt.Sprintf("%s (%d+ lines)", rel, maxLines)
			case hasControl(string(b)):
				c.skip = rel + " (control characters)"
			default:
				c.body = string(b)
			}
			if err != nil {
				// Read the file again next time rather than remembering a transient failure.
				r.skipped = append(r.skipped, c.skip)
				return nil
			}
		}
		seen[id] = c
		if c.skip != "" {
			r.skipped = append(r.skipped, c.skip)
		} else {
			notes = append(notes, note{ID: id, Body: c.body, Modified: c.modified})
		}
		return nil
	})
	if err != nil {
		return nil, r, err
	}
	s.cache = seen
	sortNotes(notes)
	return notes, r, nil
}

// sortNotes orders notes by path, ignoring case, so folders stay together.
func sortNotes(notes []note) {
	sort.Slice(notes, func(i, j int) bool {
		a, b := strings.ToLower(notes[i].ID), strings.ToLower(notes[j].ID)
		if a != b {
			return a < b
		}
		return notes[i].ID < notes[j].ID
	})
}

// path is the file holding note id.
func (s *store) path(id string) string { return filepath.Join(s.dir, filepath.FromSlash(id)+".md") }

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
	if err = renameReplace(tmp, filepath.Join(dir, name)); err != nil {
		return err
	}
	return syncDir(dir)
}

// create makes an empty note named id. It never replaces an existing file.
func (s *store) create(id string) (note, error) {
	if err := checkName(id); err != nil {
		return note{}, err
	}
	dir, err := noteDir(s.dir, id, true)
	if err != nil {
		return note{}, err
	}
	s.forget(id)
	f, err := os.OpenFile(s.path(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		return note{}, fmt.Errorf("%q already exists", id)
	}
	if err != nil {
		return note{}, err
	}
	err = f.Sync()
	if e := f.Close(); err == nil {
		err = e
	}
	if err == nil {
		err = syncDir(dir)
	}
	return note{ID: id}, err
}

// freeName returns base, or base with the lowest free " N" suffix, in folder.
func freeName(notes []note, folder, base string) string {
	taken := make(map[string]bool, len(notes))
	for _, n := range notes {
		taken[strings.ToLower(n.ID)] = true
	}
	id := joinID(folder, base)
	for i := 2; taken[strings.ToLower(id)]; i++ {
		id = joinID(folder, fmt.Sprintf("%s %d", base, i))
	}
	return id
}
func (s *store) save(n note, body string) error {
	dir, err := noteDir(s.dir, n.ID, false)
	if err != nil {
		return err
	}
	p := s.path(n.ID)
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
	s.forget(n.ID)
	return atomicWrite(dir, filepath.Base(p), []byte(body))
}

// writeRecovery preserves unsaved edits beside the notes, or in the system
// temporary directory when the data directory itself cannot be written.
func (s *store) writeRecovery(n note, body string) (string, error) {
	flat := strings.ReplaceAll(n.ID, "/", "_")
	name := fmt.Sprintf(".recovery-%s-%s.md", flat, time.Now().UTC().Format("20060102T150405.000000000"))
	err := atomicWrite(s.dir, name, []byte(body))
	if err == nil {
		return filepath.Join(s.dir, name), nil
	}
	// CreateTemp opens exclusively (0600), so a planted symlink cannot redirect it.
	f, e := os.CreateTemp("", "coyotenote-recovery-"+flat+"-*.md")
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

// legacyID matches the timestamp names of notes created before v0.2.
var legacyID = regexp.MustCompile(`^\d{8}T\d{6}\.\d{9}-[0-9a-f]{16}$`)

// displayName is the note's path, or its first line for legacy timestamp names.
func displayName(id, body string) string {
	if legacyID.MatchString(id) {
		return title(body)
	}
	return id
}
func title(body string) string {
	for _, line := range strings.Split(body, "\n") {
		if t := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#")); t != "" {
			return t
		}
	}
	return "Untitled"
}

// rename moves note n to newID, creating folders as needed. It refuses to
// replace another file; a change of letter case alone is allowed.
func (s *store) rename(n note, newID string) error {
	if err := checkName(newID); err != nil {
		return err
	}
	sourceDir, err := noteDir(s.dir, n.ID, false)
	if err != nil {
		return err
	}
	source := s.path(n.ID)
	body, err := readRegularNote(source)
	if err != nil {
		return err
	}
	if string(body) != n.Body {
		return errors.New("note changed outside coyotenote; restart before renaming")
	}
	destination := s.path(newID)
	if err = requireAbsent(destination); err != nil {
		// Case-insensitive file systems report the note itself for a case-only change.
		a, e1 := os.Lstat(source)
		b, e2 := os.Lstat(destination)
		if e1 != nil || e2 != nil || !strings.EqualFold(n.ID, newID) || !os.SameFile(a, b) {
			return fmt.Errorf("%q already exists", newID)
		}
	}
	dir, err := noteDir(s.dir, newID, true)
	if err != nil {
		return err
	}
	s.forget(n.ID, newID)
	if err = renameReplace(source, destination); err != nil {
		return err
	}
	if err = errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return movedSyncError{err}
	}
	pruneEmpty(s.dir, sourceDir)
	return nil
}
