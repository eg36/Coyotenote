package main

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

// movedSyncError means the move completed but durability could not be confirmed.
type movedSyncError struct{ error }

// trashDirectory refuses symlinks so moving notes cannot redirect user data.
func (s *store) trashDirectory(create bool) (string, error) {
	dir := filepath.Join(s.dir, ".trash")
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

// trash moves a note into .trash at the vault root, keeping its folder path.
// A name already in the trash gets the lowest free " N" suffix, so trashing
// a note never replaces an earlier one; the returned ID is its trash name.
func (s *store) trash(n note) (string, error) {
	if !validID(n.ID) {
		return "", errors.New("invalid note ID")
	}
	sourceDir, err := noteDir(s.dir, n.ID, false)
	if err != nil {
		return "", err
	}
	source := s.path(n.ID)
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
		id = joinID(folderOf(n.ID), fmt.Sprintf("%s %d", path.Base(n.ID), i))
	}
	s.forget(n.ID)
	if err = renameReplace(source, destination); err != nil {
		return "", err
	}
	if err := errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return id, movedSyncError{err}
	}
	pruneEmpty(s.dir, sourceDir)
	return id, nil
}

// restore moves the trashed note named id back to the vault as to,
// recreating its folders when needed.
func (s *store) restore(id, to string) (note, error) {
	if !validID(id) || !validID(to) {
		return note{}, errors.New("invalid note ID")
	}
	trash, err := s.trashDirectory(false)
	if err != nil {
		return note{}, err
	}
	sourceDir, err := noteDir(trash, id, false)
	if err != nil {
		return note{}, err
	}
	source := filepath.Join(trash, filepath.FromSlash(id)+".md")
	body, err := readRegularNote(source)
	if err != nil {
		return note{}, err
	}
	if !utf8.Valid(body) || lineCount(string(body)) > maxLines || hasControl(string(body)) {
		return note{}, errors.New("trashed note is not valid UTF-8, exceeds the line limit or holds control characters")
	}
	destination := s.path(to)
	if err = requireAbsent(destination); err != nil {
		return note{}, err
	}
	dir, err := noteDir(s.dir, to, true)
	if err != nil {
		return note{}, err
	}
	s.forget(to)
	if err = renameReplace(source, destination); err != nil {
		return note{}, err
	}
	n := note{ID: to, Body: string(body)}
	if err = errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return n, err
	}
	pruneEmpty(trash, sourceDir)
	return n, nil
}

// trashedNote is one note waiting in the trash.
type trashedNote struct {
	ID       string    `json:"id"`
	Modified time.Time `json:"modified"`
	Excerpt  string    `json:"excerpt"`
}

// trashed lists the notes in the trash, most recently trashed first. Files
// that could not be restored, such as symlinks, are left out.
func (s *store) trashed() ([]trashedNote, error) {
	trash, err := s.trashDirectory(false)
	if os.IsNotExist(err) {
		return []trashedNote{}, nil
	}
	if err != nil {
		return nil, err
	}
	list := []trashedNote{}
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
		if !validID(id) || err != nil {
			return nil
		}
		item := trashedNote{ID: id, Modified: info.ModTime().UTC()}
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
