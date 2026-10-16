package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// movedSyncError means the move completed but durability could not be confirmed.
type movedSyncError struct{ error }

func validNoteID(id string) bool {
	return id != "" && id != "." && id != ".." && !strings.ContainsAny(id, `/\\`) && !strings.HasPrefix(id, ".")
}

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

func (s *store) trash(n note) error {
	if !validNoteID(n.ID) {
		return errors.New("invalid note ID")
	}
	source := filepath.Join(s.dir, n.ID+".md")
	body, err := readRegularNote(source)
	if err != nil {
		return err
	}
	if string(body) != n.Body {
		return errors.New("note changed outside coyotenote; restart before deleting")
	}
	dir, err := s.trashDirectory(true)
	if err != nil {
		return err
	}
	destination := filepath.Join(dir, n.ID+".md")
	if err = requireAbsent(destination); err != nil {
		return err
	}
	if err = renameReplace(source, destination); err != nil {
		return err
	}
	if err := errors.Join(syncDir(dir), syncDir(s.dir)); err != nil {
		return movedSyncError{err}
	}
	return nil
}

func (s *store) restore(id string) (note, error) {
	if !validNoteID(id) {
		return note{}, errors.New("invalid note ID")
	}
	dir, err := s.trashDirectory(false)
	if err != nil {
		return note{}, err
	}
	source := filepath.Join(dir, id+".md")
	body, err := readRegularNote(source)
	if err != nil {
		return note{}, err
	}
	if !utf8.Valid(body) || strings.Count(string(body), "\n") >= maxLines {
		return note{}, errors.New("trashed note is not valid UTF-8 or exceeds the line limit")
	}
	destination := filepath.Join(s.dir, id+".md")
	if err = requireAbsent(destination); err != nil {
		return note{}, err
	}
	if err = renameReplace(source, destination); err != nil {
		return note{}, err
	}
	n := note{ID: id, Body: string(body)}
	return n, errors.Join(syncDir(s.dir), syncDir(dir))
}
