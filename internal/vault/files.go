package vault

import (
	"errors"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
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

// MaxMediaBytes caps a PDF, audio or video attachment.
const MaxMediaBytes = 100 << 20

var mediaTypes = map[string]string{
	".pdf":  "application/pdf",
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".ogg":  "audio/ogg",
	".oga":  "audio/ogg",
	".wav":  "audio/wav",
	".flac": "audio/flac",
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".mov":  "video/quicktime",
	".ogv":  "video/ogg",
}

// MediaType is the media type of a PDF, audio or video file name, or "" for
// other files.
func MediaType(name string) string { return mediaTypes[strings.ToLower(path.Ext(name))] }

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

// imageLink matches the address of a Markdown image, ![alt](address …),
// written plainly or in <angle brackets>.
var imageLink = regexp.MustCompile(`!\[(?:[^\]\\\n]|\\.)*\]\([ \t]*(<[^<>\n]*>|[^\s()<>]+)`)

// MovedFileLinks rewrites the image addresses in body, the text of a note
// that moved from oldID to newID, so each still shows the file it showed
// before: an address that from the new folder would find another file, or
// none, becomes a path from the new folder to the original file. Images in
// code, and addresses that find the same file either way, are left alone.
func (s *Store) MovedFileLinks(body, oldID, newID string) string {
	if FolderOf(oldID) == FolderOf(newID) || !strings.Contains(body, "![") {
		return body
	}
	code := codeRanges(body)
	matches := imageLink.FindAllStringSubmatchIndex(body, -1)
	for i := len(matches) - 1; i >= 0; i-- {
		m := matches[i]
		if inCode(code, m[0]) || escaped(body, m[0]) {
			continue
		}
		raw := body[m[2]:m[3]]
		src := strings.TrimSuffix(strings.TrimPrefix(raw, "<"), ">")
		target, ok := s.ResolveFile(src, oldID)
		if decoded, err := url.PathUnescape(src); !ok && err == nil {
			target, ok = s.ResolveFile(decoded, oldID)
		}
		if !ok {
			continue
		}
		if now, found := s.ResolveFile(src, newID); found && now == target {
			continue
		}
		from := filepath.FromSlash(FolderOf(newID))
		if from == "" {
			from = "."
		}
		rel, err := filepath.Rel(from, filepath.FromSlash(target))
		if err != nil {
			continue
		}
		address := filepath.ToSlash(rel)
		if strings.HasPrefix(raw, "<") || strings.ContainsAny(address, " ()<>") {
			address = "<" + address + ">"
		}
		body = body[:m[2]] + address + body[m[3]:]
	}
	return body
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
	if ImageType(name) == "" && MediaType(name) == "" {
		return "", errors.New("only images, PDFs, audio and video can be attached")
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

// VaultFile is one file the Library lists.
type VaultFile struct {
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// ListFiles lists every regular file below the vault root, as vault loading
// sees the vault: hidden folders and files, symlinks and the app's own
// pending and recovery files stay out. skip names root files to leave out,
// such as settings kept beside the notes.
func (s *Store) ListFiles(skip ...string) ([]VaultFile, error) {
	var files []VaultFile
	err := filepath.WalkDir(s.Dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			if p == s.Dir {
				return err
			}
			return nil
		}
		if p == s.Dir {
			return nil
		}
		if strings.HasPrefix(e.Name(), ".") {
			if e.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if e.IsDir() || !e.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(s.Dir, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		for _, name := range skip {
			if rel == name {
				return nil
			}
		}
		info, err := e.Info()
		if err != nil {
			return nil
		}
		files = append(files, VaultFile{Path: rel, Size: info.Size(), Modified: info.ModTime().UTC()})
		return nil
	})
	return files, err
}
