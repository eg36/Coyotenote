package main

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode"
)

// A note ID is its path inside the vault, slash-separated and without ".md",
// for example "Work/Project X".

// windowsReserved are device names Windows refuses as file names, with or
// without an extension.
var windowsReserved = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true}

// validID accepts IDs that stay inside the vault and outside its hidden
// directories. Windows also gets its file-name rules, so loading never
// produces a path the platform cannot open.
func validID(id string) bool {
	if id == "" || strings.ContainsAny(id, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(id, "/") {
		if segment == "" || strings.HasPrefix(segment, ".") || strings.IndexFunc(segment, unicode.IsControl) >= 0 {
			return false
		}
		if runtime.GOOS == "windows" && !portableSegment(segment) {
			return false
		}
	}
	return true
}

func portableSegment(segment string) bool {
	if strings.ContainsAny(segment, `<>:"|?*`) || strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
		return false
	}
	stem, _, _ := strings.Cut(segment, ".")
	return !windowsReserved[strings.ToUpper(strings.TrimSpace(stem))]
}

// checkName validates a name the user typed for a new or renamed note. Names
// are portable to every platform and free of characters that break [[links]].
func checkName(id string) error {
	if !validID(id) {
		return errors.New("invalid name: use folder/name without leading dots or empty parts")
	}
	for _, segment := range strings.Split(id, "/") {
		if strings.TrimSpace(segment) != segment {
			return errors.New("invalid name: no spaces at the start or end of a name")
		}
		if !portableSegment(segment) || strings.ContainsAny(segment, "[]#^|") {
			return errors.New(`invalid name: avoid < > : " | ? * [ ] # ^ and reserved names`)
		}
	}
	return nil
}

// folderOf is the folder part of an ID, "" for notes in the vault root.
func folderOf(id string) string {
	if dir := path.Dir(id); dir != "." {
		return dir
	}
	return ""
}
func joinID(folder, name string) string {
	if folder == "" {
		return name
	}
	return folder + "/" + name
}

// noteDir returns the directory holding id below root. Every existing parent
// must be a real directory, never a symlink, so writes cannot leave the vault.
// With create, missing parents are made.
func noteDir(root, id string, create bool) (string, error) {
	dir := root
	folder := folderOf(id)
	if folder == "" {
		return dir, nil
	}
	for _, segment := range strings.Split(folder, "/") {
		dir = filepath.Join(dir, segment)
		info, err := os.Lstat(dir)
		if os.IsNotExist(err) && create {
			if err = os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
				return "", err
			}
			info, err = os.Lstat(dir)
		}
		if err != nil {
			return "", err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New(dir + " is not a regular directory")
		}
	}
	return dir, nil
}
