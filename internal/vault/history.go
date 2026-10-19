package vault

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

// Earlier versions of each note are kept in .history/<note path>.md/, one
// file per version named by the UTC time it was kept. The folder is hidden,
// so neither Labradorite nor Obsidian lists it as notes.
const (
	historyDir = ".history"
	// MaxVersions is how many versions are kept per note; older ones go.
	MaxVersions = 50
)

var versionName = regexp.MustCompile(`^\d{8}T\d{6}\.\d{9}Z$`)

// Version is one kept version of a note.
type Version struct {
	ID   string    `json:"id"`
	Time time.Time `json:"time"`
	Size int64     `json:"size"`
}

// historyFolder is the folder holding note id's versions, created when
// create is set. Folders are never followed through symlinks.
func (s *Store) historyFolder(id string, create bool) (string, error) {
	if !ValidID(id) {
		return "", errors.New("invalid note path")
	}
	return noteDir(s.Dir, historyDir+"/"+id+".md/version", create)
}

// Snapshot keeps body as a version of note id and drops the oldest versions
// beyond MaxVersions.
func (s *Store) Snapshot(id, body string) error {
	dir, err := s.historyFolder(id, true)
	if err != nil {
		return err
	}
	// Clocks can be coarse; a version never replaces another.
	at := time.Now().UTC()
	name := at.Format("20060102T150405.000000000Z")
	for _, err := os.Lstat(filepath.Join(dir, name+".md")); err == nil; _, err = os.Lstat(filepath.Join(dir, name+".md")) {
		at = at.Add(time.Nanosecond)
		name = at.Format("20060102T150405.000000000Z")
	}
	if err := AtomicWrite(dir, name+".md", []byte(body)); err != nil {
		return err
	}
	versions, err := s.History(id)
	if err != nil {
		return err
	}
	for _, old := range versions[min(len(versions), MaxVersions):] {
		_ = os.Remove(filepath.Join(dir, old.ID+".md"))
	}
	return nil
}

// History lists note id's kept versions, newest first.
func (s *Store) History(id string) ([]Version, error) {
	dir, err := s.historyFolder(id, false)
	if errors.Is(err, fs.ErrNotExist) {
		return []Version{}, nil
	} else if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	versions := []Version{}
	for _, e := range entries {
		name := e.Name()
		if !e.Type().IsRegular() || filepath.Ext(name) != ".md" || !versionName.MatchString(name[:len(name)-3]) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		at, err := time.Parse("20060102T150405.000000000Z", name[:len(name)-3])
		if err != nil {
			continue
		}
		versions = append(versions, Version{ID: name[:len(name)-3], Time: at, Size: info.Size()})
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i].ID > versions[j].ID })
	return versions, nil
}

// ReadVersion returns the text of note id's kept version v.
func (s *Store) ReadVersion(id, v string) (string, error) {
	if !versionName.MatchString(v) {
		return "", errors.New("invalid version")
	}
	dir, err := s.historyFolder(id, false)
	if err != nil {
		return "", err
	}
	body, err := readRegularNote(filepath.Join(dir, v+".md"))
	return string(body), err
}

// moveHistory carries a note's versions along when it is renamed. History
// is a convenience, so a failure here never fails the rename.
func (s *Store) moveHistory(oldID, newID string) {
	from, err := s.historyFolder(oldID, false)
	if err != nil {
		return
	}
	to, err := s.historyFolder(newID, true)
	if err != nil {
		return
	}
	entries, err := os.ReadDir(from)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.Type().IsRegular() {
			_ = os.Rename(filepath.Join(from, e.Name()), filepath.Join(to, e.Name()))
		}
	}
	_ = os.Remove(from)
	pruneEmpty(filepath.Join(s.Dir, historyDir), filepath.Dir(from))
}

// dropHistory deletes the versions kept of note id.
func (s *Store) dropHistory(id string) {
	dir, err := s.historyFolder(id, false)
	if err != nil {
		return
	}
	if err := os.RemoveAll(dir); err == nil {
		pruneEmpty(filepath.Join(s.Dir, historyDir), filepath.Dir(dir))
	}
}
