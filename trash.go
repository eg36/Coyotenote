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
func (s *store) trash(n note) error {
	if !validID(n.ID) {
		return errors.New("invalid note ID")
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
		return errors.New("note changed outside coyotenote; restart before deleting")
	}
	trash, err := s.trashDirectory(true)
	if err != nil {
		return err
	}
	dir, err := noteDir(trash, n.ID, true)
	if err != nil {
		return err
	}
	destination := filepath.Join(trash, filepath.FromSlash(n.ID)+".md")
	if err = requireAbsent(destination); err != nil {
		return err
	}
	if err = renameReplace(source, destination); err != nil {
		return err
	}
	if err := errors.Join(syncDir(dir), syncDir(sourceDir)); err != nil {
		return movedSyncError{err}
	}
	return nil
}

// restore moves a trashed note back, recreating its folders when needed.
func (s *store) restore(id string) (note, error) {
	if !validID(id) {
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
	if !utf8.Valid(body) || strings.Count(string(body), "\n") >= maxLines {
		return note{}, errors.New("trashed note is not valid UTF-8 or exceeds the line limit")
	}
	destination := s.path(id)
	if err = requireAbsent(destination); err != nil {
		return note{}, err
	}
	dir, err := noteDir(s.dir, id, true)
	if err != nil {
		return note{}, err
	}
	if err = renameReplace(source, destination); err != nil {
		return note{}, err
	}
	n := note{ID: id, Body: string(body)}
	return n, errors.Join(syncDir(dir), syncDir(sourceDir))
}
