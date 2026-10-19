// Package vault reads and writes a folder of Markdown notes, the format both
// coyotenote apps share: atomic saves that refuse to overwrite outside edits,
// a trash that keeps every deletion, a lock against a second process, and
// Obsidian-style [[wiki link]] resolution.
package vault

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

// The editor holds at most MaxLines lines (a Bubbles textarea limit). Pastes are
// also capped at MaxPasteBytes so a stray clipboard dump cannot stall the UI.
const (
	MaxLines      = 10000
	MaxPasteBytes = 1 << 20
)

type Note struct {
	ID, Body string
	// Modified is the file's modification time when load read it.
	Modified time.Time
}

// EditorText gives the editor LF line endings and reports whether the file used
// CRLF, so saves can restore it. Lone CRs (classic Mac) become LF.
func EditorText(body string) (string, bool) {
	crlf := strings.Contains(body, "\r\n")
	return strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n"), crlf
}

// DiskText is the file form of editor text.
func DiskText(text string, crlf bool) string {
	if crlf {
		return strings.ReplaceAll(text, "\n", "\r\n")
	}
	return text
}

// HasControl reports control characters other than line endings and tabs. The
// editor drops them, so notes holding them are left alone instead of rewritten.
func HasControl(body string) bool {
	return strings.ContainsFunc(body, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t'
	})
}

// LineCount counts lines as the editor will hold them.
func LineCount(body string) int {
	text, _ := EditorText(body)
	return strings.Count(text, "\n") + 1
}

// LoadReport describes files that load() left alone for the user to inspect.
type LoadReport struct {
	Orphans, Recoveries int
	Skipped             []string
}
type Store struct {
	Dir string
	// Config holds user settings such as the theme. It is the vault itself for
	// the default data directory, and the data directory for other vaults.
	Config string
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

func (s *Store) forget(ids ...string) {
	for _, id := range ids {
		delete(s.cache, id)
	}
}

func DataDir() (string, error) {
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
func Open(dir string) (*Store, error) {
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
	return &Store{Dir: dir, Config: dir, lock: f}, nil
}
func (s *Store) Close() { _ = unlockFile(s.lock); _ = s.lock.Close() }

// Load reads every note below the vault root, skipping hidden directories
// such as .trash, .git and .obsidian. Files that are unsafe to edit (symlinks,
// invalid UTF-8, too many lines, unreadable) are skipped and reported, never changed.
func (s *Store) Load() ([]Note, LoadReport, error) {
	var r LoadReport
	var notes []Note
	seen := make(map[string]cachedNote, len(s.cache))
	err := filepath.WalkDir(s.Dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			if p == s.Dir {
				return err
			}
			rel, _ := filepath.Rel(s.Dir, p)
			r.Skipped = append(r.Skipped, filepath.ToSlash(rel)+" (unreadable)")
			return nil
		}
		name := e.Name()
		if p == s.Dir {
			return nil
		}
		if e.IsDir() {
			// WalkDir never follows directory symlinks; hidden directories stay private.
			if strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(s.Dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		switch {
		case strings.HasPrefix(name, ".pending-"):
			r.Orphans++
			return nil
		case strings.HasPrefix(name, ".recovery-"):
			r.Recoveries++
			return nil
		case strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".md"):
			return nil
		case e.Type()&os.ModeSymlink != 0 || !e.Type().IsRegular():
			r.Skipped = append(r.Skipped, rel+" (not a regular file)")
			return nil
		}
		id := strings.TrimSuffix(rel, ".md")
		if !ValidID(id) {
			r.Skipped = append(r.Skipped, rel+" (unsupported name)")
			return nil
		}
		info, err := e.Info()
		if err != nil {
			r.Skipped = append(r.Skipped, rel+" (unreadable)")
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
			case LineCount(string(b)) > MaxLines:
				c.skip = fmt.Sprintf("%s (%d+ lines)", rel, MaxLines)
			case HasControl(string(b)):
				c.skip = rel + " (control characters)"
			default:
				c.body = string(b)
			}
			if err != nil {
				// Read the file again next time rather than remembering a transient failure.
				r.Skipped = append(r.Skipped, c.skip)
				return nil
			}
		}
		seen[id] = c
		if c.skip != "" {
			r.Skipped = append(r.Skipped, c.skip)
		} else {
			notes = append(notes, Note{ID: id, Body: c.body, Modified: c.modified})
		}
		return nil
	})
	if err != nil {
		return nil, r, err
	}
	s.cache = seen
	SortNotes(notes)
	return notes, r, nil
}

// SortNotes orders notes by path, ignoring case, so folders stay together.
func SortNotes(notes []Note) {
	sort.Slice(notes, func(i, j int) bool {
		a, b := strings.ToLower(notes[i].ID), strings.ToLower(notes[j].ID)
		if a != b {
			return a < b
		}
		return notes[i].ID < notes[j].ID
	})
}

// Path is the file holding note id.
func (s *Store) Path(id string) string { return filepath.Join(s.Dir, filepath.FromSlash(id)+".md") }

func AtomicWrite(dir, name string, b []byte) error {
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

// Create makes a note named id holding body. It never replaces an existing
// file, and removes the new file again if writing it fails.
func (s *Store) Create(id, body string) (Note, error) {
	if err := CheckName(id); err != nil {
		return Note{}, err
	}
	dir, err := noteDir(s.Dir, id, true)
	if err != nil {
		return Note{}, err
	}
	s.forget(id)
	f, err := os.OpenFile(s.Path(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		return Note{}, fmt.Errorf("%q already exists", id)
	}
	if err != nil {
		return Note{}, err
	}
	_, err = f.WriteString(body)
	if err == nil {
		err = f.Sync()
	}
	if e := f.Close(); err == nil {
		err = e
	}
	if err != nil {
		_ = os.Remove(s.Path(id))
		return Note{}, err
	}
	return Note{ID: id, Body: body}, syncDir(dir)
}

// FreeName returns base, or base with the lowest free " N" suffix, in folder.
func FreeName(notes []Note, folder, base string) string {
	taken := make(map[string]bool, len(notes))
	for _, n := range notes {
		taken[strings.ToLower(n.ID)] = true
	}
	id := JoinID(folder, base)
	for i := 2; taken[strings.ToLower(id)]; i++ {
		id = JoinID(folder, fmt.Sprintf("%s %d", base, i))
	}
	return id
}
func (s *Store) Save(n Note, body string) error {
	dir, err := noteDir(s.Dir, n.ID, false)
	if err != nil {
		return err
	}
	p := s.Path(n.ID)
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
	return AtomicWrite(dir, filepath.Base(p), []byte(body))
}

// WriteRecovery preserves unsaved edits beside the notes, or in the system
// temporary directory when the data directory itself cannot be written.
func (s *Store) WriteRecovery(n Note, body string) (string, error) {
	flat := strings.ReplaceAll(n.ID, "/", "_")
	name := fmt.Sprintf(".recovery-%s-%s.md", flat, time.Now().UTC().Format("20060102T150405.000000000"))
	err := AtomicWrite(s.Dir, name, []byte(body))
	if err == nil {
		return filepath.Join(s.Dir, name), nil
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

// LegacyID matches the timestamp names of notes created before v0.2.
var LegacyID = regexp.MustCompile(`^\d{8}T\d{6}\.\d{9}-[0-9a-f]{16}$`)

// DisplayName is the note's path, or its first line for legacy timestamp names.
func DisplayName(id, body string) string {
	if LegacyID.MatchString(id) {
		return Title(body)
	}
	return id
}
func Title(body string) string {
	for _, line := range strings.Split(body, "\n") {
		if t := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#")); t != "" {
			return t
		}
	}
	return "Untitled"
}

// Rename moves note n to newID, creating folders as needed. It refuses to
// replace another file; a change of letter case alone is allowed.
func (s *Store) Rename(n Note, newID string) error {
	if err := CheckName(newID); err != nil {
		return err
	}
	sourceDir, err := noteDir(s.Dir, n.ID, false)
	if err != nil {
		return err
	}
	source := s.Path(n.ID)
	body, err := readRegularNote(source)
	if err != nil {
		return err
	}
	if string(body) != n.Body {
		return errors.New("note changed outside coyotenote; restart before renaming")
	}
	destination := s.Path(newID)
	if err = requireAbsent(destination); err != nil {
		// Case-insensitive file systems report the note itself for a case-only change.
		a, e1 := os.Lstat(source)
		b, e2 := os.Lstat(destination)
		if e1 != nil || e2 != nil || !strings.EqualFold(n.ID, newID) || !os.SameFile(a, b) {
			return fmt.Errorf("%q already exists", newID)
		}
	}
	dir, err := noteDir(s.Dir, newID, true)
	if err != nil {
		return err
	}
	s.forget(n.ID, newID)
	if err = renameReplace(source, destination); err != nil {
		return err
	}
	if err = errors.Join(MoveSync(dir), MoveSync(sourceDir)); err != nil {
		return MovedSyncError{err}
	}
	pruneEmpty(s.Dir, sourceDir)
	return nil
}
