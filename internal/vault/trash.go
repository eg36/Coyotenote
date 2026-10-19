package vault

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// MovedSyncError means the move completed but durability could not be confirmed.
type MovedSyncError struct{ error }

// trashDirectory refuses symlinks so moving notes cannot redirect user data.
func (s *Store) trashDirectory(create bool) (string, error) {
	dir := filepath.Join(s.Dir, ".trash")
	if create {
		if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
			return "", err
		}
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("trash is no longer a regular directory")
	}
	return dir, nil
}

func readRegularNote(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("note is no longer a regular file")
	}
	return os.ReadFile(path)
}

func requireAbsent(path string) error {
	_, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return errors.New("destination already exists; move the conflicting file before retrying")
}

// Trash moves a note into .Trash at the vault root, keeping its folder path.
// A name already in the Trash gets the lowest free " N" suffix, so trashing
// a note never replaces an earlier one; the returned ID is its Trash name.
func (s *Store) Trash(n Note) (string, error) {
	if !ValidID(n.ID) {
		return "", errors.New("invalid note ID")
	}
	sourceDir, err := noteDir(s.Dir, n.ID, false)
	if err != nil {
		return "", err
	}
	source := s.Path(n.ID)
	body, err := readRegularNote(source)
	if err != nil {
		return "", err
	}
	if string(body) != n.Body {
		return "", errors.New("note changed outside coyotenote; restart before deleting")
	}
	trash, err := s.trashDirectory(true)
	if err != nil {
		return "", err
	}
	dir, err := noteDir(trash, n.ID, true)
	if err != nil {
		return "", err
	}
	id, destination := n.ID, ""
	for i := 2; ; i++ {
		destination = filepath.Join(trash, filepath.FromSlash(id)+".md")
		if err = requireAbsent(destination); err == nil {
			break
		}
		if _, statErr := os.Lstat(destination); statErr != nil {
			return "", err
		}
		id = JoinID(FolderOf(n.ID), fmt.Sprintf("%s %d", path.Base(n.ID), i))
	}
	s.forget(n.ID)
	if err = renameReplace(source, destination); err != nil {
		return "", err
	}
	if err := errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return id, MovedSyncError{err}
	}
	pruneEmpty(s.Dir, sourceDir)
	return id, nil
}

// Restore moves the trashed note named id back to the vault as to,
// recreating its folders when needed.
func (s *Store) Restore(id, to string) (Note, error) {
	if !ValidID(id) || !ValidID(to) {
		return Note{}, errors.New("invalid note ID")
	}
	trash, err := s.trashDirectory(false)
	if err != nil {
		return Note{}, err
	}
	sourceDir, err := noteDir(trash, id, false)
	if err != nil {
		return Note{}, err
	}
	source := filepath.Join(trash, filepath.FromSlash(id)+".md")
	body, err := readRegularNote(source)
	if err != nil {
		return Note{}, err
	}
	if !utf8.Valid(body) || LineCount(string(body)) > MaxLines || HasControl(string(body)) {
		return Note{}, errors.New("trashed note is not valid UTF-8, exceeds the line limit or holds control characters")
	}
	destination := s.Path(to)
	if err = requireAbsent(destination); err != nil {
		return Note{}, err
	}
	dir, err := noteDir(s.Dir, to, true)
	if err != nil {
		return Note{}, err
	}
	s.forget(to)
	if err = renameReplace(source, destination); err != nil {
		return Note{}, err
	}
	n := Note{ID: to, Body: string(body)}
	if err = errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return n, err
	}
	pruneEmpty(trash, sourceDir)
	return n, nil
}

// TrashedNote is one note waiting in the trash.
type TrashedNote struct {
	ID       string    `json:"id"`
	Modified time.Time `json:"modified"`
	Excerpt  string    `json:"excerpt"`
}

// Trashed lists the notes in the trash, most recently Trashed first. Files
// that could not be restored, such as symlinks, are left out.
func (s *Store) Trashed() ([]TrashedNote, error) {
	trash, err := s.trashDirectory(false)
	if os.IsNotExist(err) {
		return []TrashedNote{}, nil
	}
	if err != nil {
		return nil, err
	}
	list := []TrashedNote{}
	err = filepath.WalkDir(trash, func(p string, e fs.DirEntry, err error) error {
		if err != nil || p == trash {
			return err
		}
		if e.IsDir() {
			if strings.HasPrefix(e.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(trash, p)
		if err != nil || !e.Type().IsRegular() || !strings.HasSuffix(e.Name(), ".md") {
			return err
		}
		id := strings.TrimSuffix(filepath.ToSlash(rel), ".md")
		info, err := e.Info()
		if !ValidID(id) || err != nil {
			return nil
		}
		item := TrashedNote{ID: id, Modified: info.ModTime().UTC()}
		if b, err := os.ReadFile(p); err == nil && utf8.Valid(b) {
			item.Excerpt = strings.Join(strings.Fields(string(b)), " ")
			if runes := []rune(item.Excerpt); len(runes) > 140 {
				item.Excerpt = string(runes[:140]) + "…"
			}
		}
		list = append(list, item)
		return nil
	})
	sort.SliceStable(list, func(i, j int) bool { return list[i].Modified.After(list[j].Modified) })
	return list, err
}
