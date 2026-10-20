package vault

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
)

// Attachments are files other than notes kept in the vault. New ones are
// saved in AttachmentDir; links may point at images anywhere in the vault.
const (
	AttachmentDir      = "attachments"
	MaxAttachmentBytes = 20 << 20
)

var imageTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg":  "image/svg+xml",
}

// ImageType is the media type of an image file name, or "" for files that
// Labradorite does not show.
func ImageType(name string) string { return imageTypes[strings.ToLower(path.Ext(name))] }

// regularFile reports whether the vault-relative path rel names a regular
// file reached without symlinks or hidden folders.
func (s *Store) regularFile(rel string) bool {
	if !ValidID(rel) {
		return false
	}
	dir, err := noteDir(s.Dir, rel, false)
	if err != nil {
		return false
	}
	info, err := os.Lstat(filepath.Join(dir, path.Base(rel)))
	return err == nil && info.Mode().IsRegular()
}

// ResolveFile finds the vault file that src, as written in note from, points
// to: relative to the note's folder first, then to the vault root. It
// returns the file's vault-relative path.
func (s *Store) ResolveFile(src, from string) (string, bool) {
	src = strings.TrimPrefix(strings.ReplaceAll(src, `\`, "/"), "/")
	if src == "" || strings.Contains(src, ":") {
		return "", false
	}
	for _, candidate := range []string{path.Join(FolderOf(from), src), path.Clean(src)} {
		if !strings.HasPrefix(candidate, "../") && s.regularFile(candidate) {
			return candidate, true
		}
	}
	return "", false
}

// FindFile finds a file by name anywhere in the vault outside hidden
// folders, as an embed such as ![[photo.png]] may name it. The shortest
// path wins, then the first in path order.
func (s *Store) FindFile(name string) (string, bool) {
	name = strings.ToLower(path.Base(strings.ReplaceAll(name, `\`, "/")))
	best := ""
	_ = filepath.WalkDir(s.Dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if e.IsDir() {
			if p != s.Dir && strings.HasPrefix(e.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		if strings.ToLower(e.Name()) != name || !e.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(s.Dir, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if best == "" || strings.Count(rel, "/") < strings.Count(best, "/") || (strings.Count(rel, "/") == strings.Count(best, "/") && rel < best) {
			best = rel
		}
		return nil
	})
	return best, best != "" && s.regularFile(best)
}

// OpenFile opens the vault file rel for reading, refusing symlinks and
// files in hidden folders.
func (s *Store) OpenFile(rel string) (*os.File, error) {
	if !s.regularFile(rel) {
		return nil, fs.ErrNotExist
	}
	return os.Open(filepath.Join(s.Dir, filepath.FromSlash(rel)))
}

// attachmentName turns an uploaded file's name into a portable one: letters,
// digits, dots, dashes and underscores, with other runs becoming one dash.
func attachmentName(name string) string {
	name = path.Base(strings.ReplaceAll(name, `\`, "/"))
	ext := strings.ToLower(path.Ext(name))
	var stem strings.Builder
	dash := false
	for _, r := range strings.TrimSuffix(name, path.Ext(name)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			stem.WriteRune(r)
			dash = false
		} else if !dash && stem.Len() > 0 {
			stem.WriteByte('-')
			dash = true
		}
	}
	clean := strings.Trim(stem.String(), "-")
	if runes := []rune(clean); len(runes) > 80 {
		clean = string(runes[:80])
	}
	if clean == "" || !portableSegment(clean+ext) {
		clean = "image"
	}
	return clean + ext
}

// SaveAttachment writes data into AttachmentDir under a free version of
// name and returns its vault-relative path. It never replaces a file.
func (s *Store) SaveAttachment(name string, data []byte) (string, error) {
	name = attachmentName(name)
	if ImageType(name) == "" {
		return "", errors.New("only PNG, JPEG, GIF, WebP, AVIF and SVG images can be attached")
	}
	dir, err := noteDir(s.Dir, AttachmentDir+"/"+name, true)
	if err != nil {
		return "", err
	}
	stem, ext := strings.TrimSuffix(name, path.Ext(name)), path.Ext(name)
	for i := 1; ; i++ {
		candidate := name
		if i > 1 {
			candidate = stem + "-" + strconv.Itoa(i) + ext
		}
		if _, err := os.Lstat(filepath.Join(dir, candidate)); errors.Is(err, fs.ErrNotExist) {
			if err := AtomicWrite(dir, candidate, data); err != nil {
				return "", err
			}
			return AttachmentDir + "/" + candidate, nil
		} else if err != nil {
			return "", err
		}
	}
}
