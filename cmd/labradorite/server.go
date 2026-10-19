package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/eg36/labradorite/internal/vault"
	"github.com/eg36/labradorite/internal/version"
	"github.com/eg36/labradorite/web"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

const maxBodyBytes = vault.MaxNoteBytes

type webApp struct {
	store    *vault.Store
	mu       sync.Mutex
	token    string
	port     int
	renderer goldmark.Markdown
	// written holds the revision of what this process last saved to each
	// note, so a save can tell when the file changed outside the app.
	written map[string]string
	// formerIDs are IDs this vault had at earlier paths, so the browser can
	// find drafts it filed under them.
	formerIDs []string
	// derived keeps what each note's list entry and links were computed
	// from and to, so a large vault's unchanged notes are not parsed again
	// on every list refresh.
	derived map[string]derivedNote
}

type derivedNote struct {
	body     string
	modified time.Time
	view     noteView // without Body and Backlinks
	links    []vault.Link
}

// vaultID names the vault at dir for the browser, which files drafts and
// settings under it.
func vaultID(dir string) string {
	absolute, _ := filepath.Abs(dir)
	return revision(absolute)[:16]
}

// versionInterval is how often a note's history keeps a version while
// autosave writes it again and again.
const versionInterval = 10 * time.Minute

type noteView struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Body      string   `json:"body,omitempty"`
	Excerpt   string   `json:"excerpt"`
	Revision  string   `json:"revision"`
	Modified  string   `json:"modified"`
	Words     int      `json:"words"`
	Backlinks []string `json:"backlinks"`
	Tags      []string `json:"tags"`
	Warning   string   `json:"warning,omitempty"`
	// Stamps holds the vault's stamp before and after a save, so the tab
	// that saved can tell its own write from changes made elsewhere.
	Stamps []string `json:"stamps,omitempty"`
}

type mutation struct {
	ID       string `json:"id"`
	Body     string `json:"body"`
	Revision string `json:"revision"`
	Name     string `json:"name"`
	Theme    string `json:"theme"`
}

type apiError struct {
	status  int
	message string
	current *noteView
}

func (e *apiError) Error() string { return e.message }

func init() {
	// Browsers read the manifest that makes the app installable by this type.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func newWebApp(s *vault.Store) (*webApp, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	return &webApp{store: s, token: hex.EncodeToString(token[:]), written: map[string]string{}, renderer: goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithParserOptions(parser.WithAutoHeadingID()))}, nil
}

func revision(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}

func (a *webApp) trustedHost(host string) bool {
	name, port, err := net.SplitHostPort(host)
	if err != nil || port != strconv.Itoa(a.port) {
		return false
	}
	ip := net.ParseIP(name)
	return name == "localhost" || ip != nil && ip.IsLoopback()
}

func (a *webApp) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("Cache-Control", "no-store")
	if !a.trustedHost(r.Host) {
		http.Error(w, "This local app only accepts loopback hosts.", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/vault-file" {
		a.serveFile(w, r)
		return
	}
	if r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version.String()})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			writeError(w, &apiError{status: 403, message: "cross-origin requests are not allowed"})
			return
		}
		if r.Method != "GET" && r.Header.Get("X-Labradorite-Token") != a.token {
			writeError(w, &apiError{status: 403, message: "missing local session token; reload the page"})
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if err := a.api(w, r); err != nil {
			writeError(w, err)
		}
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/" {
		data, _ := web.Files.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
		return
	}
	if r.URL.Path == "/favicon.ico" {
		// Browsers ask for this before reading the page's icon links.
		r.URL.Path = "/assets/favicon.ico"
	}
	if r.URL.Path == "/assets/logo.png" {
		data, _ := web.Files.ReadFile("logo.png")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		http.FileServer(http.FS(web.Files)).ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}

func decode(w http.ResponseWriter, r *http.Request) (mutation, error) {
	var in mutation
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes*6+65536)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, &apiError{status: 400, message: "invalid or oversized JSON request"}
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return in, &apiError{status: 400, message: "expected one JSON object"}
	}
	return in, nil
}

func validateBody(body string) error {
	switch {
	case len(body) > maxBodyBytes:
		return &apiError{status: 422, message: "A note can contain up to 4 MiB in the web app."}
	case !utf8.ValidString(body) || vault.HasControl(body):
		return &apiError{status: 422, message: "Notes must be UTF-8 text without control characters."}
	case vault.LineCount(body) > vault.MaxLines:
		return &apiError{status: 422, message: "A note can contain up to 10,000 lines."}
	}
	return nil
}

// load reads the vault. Files over the note size limit are skipped by size
// before they are read, and reported.
func (a *webApp) load() ([]vault.Note, vault.LoadReport, error) {
	return a.store.Load()
}

func view(s *vault.Store, n vault.Note, includeBody bool) noteView {
	text, _ := vault.EditorText(n.Body)
	_, content := vault.SplitFrontMatter(text)
	fields := strings.Fields(content)
	excerpt := ""
	for _, word := range fields {
		if excerpt != "" {
			excerpt += " "
		}
		excerpt += word
		if utf8.RuneCountInString(excerpt) > 140 {
			excerpt = string([]rune(excerpt)[:140]) + "…"
			break
		}
	}
	modified := n.Modified
	if modified.IsZero() {
		if info, err := os.Stat(s.Path(n.ID)); err == nil {
			modified = info.ModTime()
		}
	}
	v := noteView{ID: n.ID, Title: vault.DisplayName(n.ID, n.Body), Excerpt: excerpt, Revision: revision(n.Body), Words: len(fields), Backlinks: []string{}, Tags: vault.Tags(n.Body)}
	if v.Tags == nil {
		v.Tags = []string{}
	}
	if !modified.IsZero() {
		v.Modified = modified.UTC().Format(time.RFC3339Nano)
	}
	if includeBody {
		v.Body = text
	}
	return v
}

// derive returns n's list entry and links, from the cache while n's text
// and modification time are unchanged. Notes without a modification time
// are computed fresh, since view looks theirs up on disk.
func (a *webApp) derive(n vault.Note) derivedNote {
	if d, ok := a.derived[n.ID]; ok && d.body == n.Body && d.modified.Equal(n.Modified) && !n.Modified.IsZero() {
		return d
	}
	d := derivedNote{body: n.Body, modified: n.Modified, view: view(a.store, n, false), links: vault.ParseLinks(n.Body)}
	if !n.Modified.IsZero() {
		if a.derived == nil {
			a.derived = map[string]derivedNote{}
		}
		a.derived[n.ID] = d
	}
	return d
}

// forgetDerived drops cached entries for notes no longer in the vault.
func (a *webApp) forgetDerived(notes []vault.Note) {
	keep := make(map[string]derivedNote, len(notes))
	for _, n := range notes {
		if d, ok := a.derived[n.ID]; ok {
			keep[n.ID] = d
		}
	}
	a.derived = keep
}

// stamp identifies the vault's notes and their contents. Open tabs poll it
// to notice changes made outside the app, or in another tab, while they
// stay open.
func (a *webApp) stamp(notes []vault.Note) string {
	h := sha256.New()
	for _, n := range notes {
		_, _ = io.WriteString(h, n.ID+"\x00"+a.derive(n).view.Revision+"\x00")
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// eachBacklink calls visit for every note linking to another note, once
// per pair.
func (a *webApp) eachBacklink(notes []vault.Note, visit func(from, to string)) {
	resolver := vault.NewResolver(notes)
	for _, n := range notes {
		seen := map[string]bool{}
		for _, l := range a.derive(n).links {
			if id, ok := resolver.Resolve(l.Target, n.ID); ok && id != n.ID && !seen[id] {
				visit(n.ID, id)
				seen[id] = true
			}
		}
	}
}

func (a *webApp) views(notes []vault.Note, includeBody bool) []noteView {
	result := make([]noteView, 0, len(notes))
	byID := make(map[string]int)
	for _, n := range notes {
		byID[n.ID] = len(result)
		v := a.derive(n).view
		v.Backlinks = []string{}
		if includeBody {
			v.Body, _ = vault.EditorText(n.Body)
		}
		result = append(result, v)
	}
	a.eachBacklink(notes, func(from, to string) {
		result[byID[to]].Backlinks = append(result[byID[to]].Backlinks, from)
	})
	return result
}

func (a *webApp) current(id string, notes []vault.Note, expected string) (vault.Note, *noteView, error) {
	if !vault.ValidID(id) {
		return vault.Note{}, nil, &apiError{status: 400, message: "invalid note path"}
	}
	for _, n := range notes {
		if n.ID == id {
			v := a.derive(n).view
			v.Backlinks = []string{}
			v.Body, _ = vault.EditorText(n.Body)
			a.eachBacklink(notes, func(from, to string) {
				if to == id {
					v.Backlinks = append(v.Backlinks, from)
				}
			})
			if expected != "" && expected != v.Revision {
				return n, &v, &apiError{status: 409, message: "This note changed in another tab or program. Your edits are kept locally.", current: &v}
			}
			return n, &v, nil
		}
	}
	return vault.Note{}, nil, &apiError{status: 404, message: "Note not found. It may have been moved or deleted."}
}

func (a *webApp) api(w http.ResponseWriter, r *http.Request) error {
	if r.Method+" "+r.URL.Path == "GET /api/session" {
		// A cheap way for an open tab to renew its token after a restart.
		writeJSON(w, 200, map[string]string{"token": a.token, "vaultId": vaultID(a.store.Dir)})
		return nil
	}
	notes, report, err := a.load()
	if err != nil {
		return err
	}
	route := r.Method + " " + r.URL.Path
	if route == "GET /api/stamp" {
		writeJSON(w, 200, map[string]string{"stamp": a.stamp(notes)})
		return nil
	}
	if route == "GET /api/state" {
		theme := "dark"
		if b, e := os.ReadFile(filepath.Join(a.store.Config, "theme")); e == nil && validTheme(strings.TrimSpace(string(b))) {
			theme = strings.TrimSpace(string(b))
		}
		a.forgetDerived(notes)
		list := a.views(notes, false)
		// Notes always lists the whole vault; matches names the search hits,
		// so a filtered sidebar never leaves stale notes behind.
		var matches []string
		snippets := map[string]string{}
		if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))); q != "" {
			matches = []string{}
			for _, n := range notes {
				if strings.Contains(strings.ToLower(n.ID+"\n"+n.Body), q) {
					matches = append(matches, n.ID)
					if s := snippet(n.Body, q); s != "" {
						snippets[n.ID] = s
					}
				}
			}
		}
		themeList := []map[string]any{}
		for _, t := range themes {
			p := t.colors
			themeList = append(themeList, map[string]any{"id": t.id, "name": t.name, "light": t.light, "colors": map[string]string{"surface": p.surface, "chrome": p.chrome, "text": p.text, "muted": p.muted, "accent": p.accent, "cyan": p.cyan, "good": p.good, "warn": p.warn, "danger": p.danger, "line": p.line, "pink": p.pink, "blue": p.blue, "onPill": p.onPill}})
		}
		absolute, _ := filepath.Abs(a.store.Dir)
		warnings := append([]string{}, report.Skipped...)
		if report.Orphans > 0 {
			warnings = append(warnings, fmt.Sprintf("%d interrupted-write files retained in the vault", report.Orphans))
		}
		if report.Recoveries > 0 {
			warnings = append(warnings, fmt.Sprintf("%d recovery copies retained in the vault", report.Recoveries))
		}
		writeJSON(w, 200, map[string]any{"notes": list, "matches": matches, "snippets": snippets, "themes": themeList, "theme": theme, "vault": filepath.Base(absolute), "vaultId": vaultID(a.store.Dir), "formerVaultIds": append([]string{}, a.formerIDs...), "token": a.token, "stamp": a.stamp(notes), "version": version.String(), "warnings": warnings, "limits": map[string]int{"lines": vault.MaxLines, "bytes": maxBodyBytes}})
		return nil
	}
	if route == "GET /api/note" || route == "GET /api/export" {
		n, v, err := a.current(r.URL.Query().Get("id"), notes, "")
		if err != nil {
			return err
		}
		if route == "GET /api/export" {
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename*=UTF-8''`+url.PathEscape(path.Base(n.ID)+".md"))
			_, _ = io.WriteString(w, n.Body)
		} else {
			writeJSON(w, 200, v)
		}
		return nil
	}
	if route == "GET /api/history" || route == "GET /api/version" {
		n, _, err := a.current(r.URL.Query().Get("id"), notes, "")
		if err != nil {
			return err
		}
		if route == "GET /api/history" {
			versions, err := a.store.History(n.ID)
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]any{"versions": versions})
			return nil
		}
		body, err := a.store.ReadVersion(n.ID, r.URL.Query().Get("v"))
		if err != nil {
			return &apiError{status: 404, message: "That version is no longer kept."}
		}
		text, _ := vault.EditorText(body)
		writeJSON(w, 200, map[string]string{"body": text})
		return nil
	}
	if route == "GET /api/trash" {
		list, err := a.store.Trashed()
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"notes": list})
		return nil
	}
	if route == "POST /api/attachment" {
		return a.attach(w, r)
	}
	in, err := decode(w, r)
	if err != nil {
		return err
	}
	switch route {
	case "POST /api/note":
		if in.ID == "" {
			in.ID = vault.FreeName(notes, "", "Untitled")
		}
		if err = vault.CheckName(in.ID); err != nil {
			return &apiError{status: 422, message: err.Error()}
		}
		for _, n := range notes {
			if strings.EqualFold(n.ID, in.ID) {
				return &apiError{status: 409, message: "A note with that name already exists."}
			}
		}
		if err = validateBody(in.Body); err != nil {
			return err
		}
		n, err := a.store.Create(in.ID, in.Body)
		if err != nil {
			return err
		}
		writeJSON(w, 201, a.views([]vault.Note{n}, true)[0])
		return nil
	case "PUT /api/note", "DELETE /api/note", "POST /api/rename":
		if in.Revision == "" {
			return &apiError{status: 428, message: "A revision is required to protect existing edits."}
		}
		n, _, err := a.current(in.ID, notes, in.Revision)
		if err != nil {
			return err
		}
		switch route {
		case "PUT /api/note":
			if err = validateBody(in.Body); err != nil {
				return err
			}
			_, crlf := vault.EditorText(n.Body)
			body := vault.DiskText(in.Body, crlf)
			warning := a.keepVersion(n, false)
			before := a.stamp(notes)
			if err = a.store.Save(n, body); err != nil {
				return &apiError{status: 409, message: err.Error()}
			}
			a.written[n.ID] = revision(body)
			n.Body, n.Modified = body, time.Time{}
			for i := range notes {
				if notes[i].ID == n.ID {
					notes[i] = n
				}
			}
			_, view, err := a.current(n.ID, notes, "")
			if err != nil {
				return err
			}
			view.Warning = warning
			view.Stamps = []string{before, a.stamp(notes)}
			writeJSON(w, 200, view)
		case "DELETE /api/note":
			trashID, err := a.store.Trash(n)
			warning, err := completedMove(err)
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]string{"trashed": n.ID, "trashId": trashID, "warning": warning})
		case "POST /api/rename":
			if in.Name == n.ID {
				writeJSON(w, 200, map[string]any{"note": a.views([]vault.Note{n}, true)[0], "warnings": []string{}})
				return nil
			}
			if err = vault.CheckName(in.Name); err != nil {
				return &apiError{status: 422, message: err.Error()}
			}
			for _, other := range notes {
				if other.ID != n.ID && strings.EqualFold(other.ID, in.Name) {
					return &apiError{status: 409, message: "A note with that name already exists."}
				}
			}
			warning, err := completedMove(a.store.Rename(n, in.Name))
			if err != nil {
				return err
			}
			warnings := a.rewriteLinks(notes, n.ID, in.Name)
			if warning != "" {
				warnings = append([]string{warning}, warnings...)
			}
			refreshed, _, err := a.load()
			if err != nil {
				return err
			}
			_, view, err := a.current(in.Name, refreshed, "")
			if err != nil {
				return err
			}
			writeJSON(w, 200, map[string]any{"note": view, "warnings": warnings})
		}
		return nil
	case "POST /api/trash/empty":
		deleted, err := a.store.EmptyTrash(notes)
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]int{"deleted": deleted})
		return nil
	case "POST /api/history/restore":
		n, _, err := a.current(in.ID, notes, in.Revision)
		if err != nil {
			return err
		}
		body, err := a.store.ReadVersion(n.ID, in.Name)
		if err != nil {
			return &apiError{status: 404, message: "That version is no longer kept."}
		}
		if err = validateBody(body); err != nil {
			return err
		}
		// The text being replaced is always kept, so a restore can be undone.
		if warning := a.keepVersion(n, true); warning != "" {
			return &apiError{status: 500, message: warning}
		}
		if err = a.store.Save(n, body); err != nil {
			return &apiError{status: 409, message: err.Error()}
		}
		a.written[n.ID] = revision(body)
		n.Body, n.Modified = body, time.Time{}
		writeJSON(w, 200, a.views([]vault.Note{n}, true)[0])
		return nil
	case "POST /api/restore":
		// Name is the note's original path when its trash name has a suffix.
		to := in.Name
		if to == "" {
			to = in.ID
		}
		n, err := a.store.Restore(in.ID, to)
		warning, err := completedMove(err)
		if err != nil {
			return &apiError{status: 409, message: err.Error()}
		}
		restored := a.views([]vault.Note{n}, true)[0]
		restored.Warning = warning
		writeJSON(w, 200, restored)
		return nil
	case "POST /api/settings":
		if !validTheme(in.Theme) {
			return &apiError{status: 422, message: "unknown theme"}
		}
		if err = vault.AtomicWrite(a.store.Config, "theme", []byte(in.Theme)); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]string{"theme": in.Theme})
		return nil
	case "POST /api/resolve":
		if len(in.Body) > 4096 {
			return &apiError{status: 422, message: "link target is too long"}
		}
		links := vault.ParseLinks("[[" + in.Body + "]]")
		if len(links) != 1 {
			return &apiError{status: 422, message: "invalid wiki link"}
		}
		l := links[0]
		id, found := vault.NewResolver(notes).Resolve(l.Target, in.ID)
		writeJSON(w, 200, map[string]any{"id": id, "found": found, "target": l.Target, "heading": l.Heading})
		return nil
	case "POST /api/render":
		if err = validateBody(in.Body); err != nil {
			return err
		}
		out, err := a.render(in.Body, in.ID, notes)
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]string{"html": out})
		return nil
	case "POST /api/recovery":
		if !vault.ValidID(in.ID) {
			return &apiError{status: 422, message: "invalid note path"}
		}
		if err = validateBody(in.Body); err != nil {
			return err
		}
		file, err := a.store.WriteRecovery(vault.Note{ID: in.ID}, in.Body)
		if err != nil {
			return err
		}
		writeJSON(w, 201, map[string]string{"path": file})
		return nil
	}
	return &apiError{status: 404, message: "API route not found"}
}

// keepVersion keeps the text a save is about to replace in the note's
// history: always when forced or when the file changed outside the app since
// this process last wrote it, otherwise at most every versionInterval. It
// returns a warning when the version could not be kept.
func (a *webApp) keepVersion(n vault.Note, force bool) string {
	if n.Body == "" && !force {
		return ""
	}
	if !force && a.written[n.ID] == revision(n.Body) {
		versions, err := a.store.History(n.ID)
		if err == nil && len(versions) > 0 && time.Since(versions[0].Time) < versionInterval {
			return ""
		}
	}
	if err := a.store.Snapshot(n.ID, n.Body); err != nil {
		return "An earlier version of this note could not be kept: " + err.Error()
	}
	return ""
}

// completedMove turns the error of a move that finished but could not be
// synced into a warning, so the client still sees the move and updates.
func completedMove(err error) (string, error) {
	var moved vault.MovedSyncError
	if errors.As(err, &moved) {
		return "The note was moved, but the change could not be confirmed on disk: " + moved.Error(), nil
	}
	return "", err
}

// rewriteLinks saves the link updates for renaming oldID to newID. Notes
// changed since they were read are left alone and reported.
func (a *webApp) rewriteLinks(before []vault.Note, oldID, newID string) []string {
	warnings := []string{}
	for _, u := range vault.RenameLinks(before, oldID, newID) {
		if err := a.store.Save(u.Note, u.Body); err != nil {
			warnings = append(warnings, "Could not update links in "+u.Note.ID+": "+err.Error())
		}
	}
	return warnings
}

// fileURL is where the browser fetches the vault file src links to from
// note from.
func fileURL(from, src string) string {
	return "/vault-file?" + url.Values{"from": {from}, "src": {src}}.Encode()
}

// serveFile sends an image from the vault to this app's own pages. Other
// sites cannot embed it, and it may not run scripts even when opened.
func (a *webApp) serveFile(w http.ResponseWriter, r *http.Request) {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		http.Error(w, "Vault files are only shown in this app.", http.StatusForbidden)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	query := r.URL.Query()
	rel, ok := a.store.ResolveFile(query.Get("src"), query.Get("from"))
	if decoded, err := url.PathUnescape(query.Get("src")); !ok && err == nil {
		rel, ok = a.store.ResolveFile(decoded, query.Get("from"))
	}
	kind := vault.ImageType(rel)
	if !ok || kind == "" {
		http.NotFound(w, r)
		return
	}
	f, err := a.store.OpenFile(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// attach saves an uploaded image in the vault's attachment folder. The body
// is the file itself, named by the name query parameter.
func (a *webApp) attach(w http.ResponseWriter, r *http.Request) error {
	name := r.URL.Query().Get("name")
	kind := vault.ImageType(name)
	if kind == "" {
		return &apiError{status: 415, message: "Only PNG, JPEG, GIF, WebP, AVIF and SVG images can be attached."}
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, vault.MaxAttachmentBytes+1))
	if err != nil || len(data) > vault.MaxAttachmentBytes {
		return &apiError{status: 413, message: "An image can be up to 20 MiB."}
	}
	sniffed := http.DetectContentType(data)
	if kind == "image/svg+xml" {
		if !bytes.Contains(bytes.ToLower(data[:min(len(data), 4096)]), []byte("<svg")) {
			return &apiError{status: 415, message: "That file is not an SVG image."}
		}
	} else if sniffed != kind && !(kind == "image/avif" && sniffed == "application/octet-stream") {
		return &apiError{status: 415, message: "That file's contents do not match its image type."}
	}
	rel, err := a.store.SaveAttachment(name, data)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"path": rel})
	return nil
}

// embedImage is the Markdown image for an Obsidian embed such as
// ![[photo.png|caption]], or "" when l does not embed an image.
func embedImage(body string, l vault.Link) string {
	if l.Start == 0 || body[l.Start-1] != '!' || vault.ImageType(l.Target) == "" {
		return ""
	}
	alt := l.Alias
	if alt == "" {
		alt = path.Base(l.Target)
	}
	alt = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]").Replace(alt)
	return "![" + alt + "](<" + l.Target + embedMark + ">)"
}

// embedMark ends the destination of an image made from an embed, which is
// found by file name anywhere in the vault rather than by path.
const embedMark = "#embed"

// localImages points images in document at the vault files they name, so
// the preview can show them. Remote images keep their address and are
// removed by suppressImages.
func (a *webApp) localImages(document ast.Node, from string) {
	_ = ast.Walk(document, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		image, ok := n.(*ast.Image)
		if !ok || !entering {
			return ast.WalkContinue, nil
		}
		dest := string(image.Destination)
		embed := strings.HasSuffix(dest, embedMark)
		dest = strings.TrimSuffix(dest, embedMark)
		if strings.Contains(dest, ":") || strings.HasPrefix(dest, "//") {
			return ast.WalkContinue, nil
		}
		if decoded, err := url.PathUnescape(dest); err == nil {
			dest = decoded
		}
		rel, found := a.store.ResolveFile(dest, from)
		if !found && embed {
			rel, found = a.store.FindFile(dest)
		}
		if found && vault.ImageType(rel) != "" {
			image.Destination = []byte(fileURL("", rel))
		} else {
			image.Destination = []byte("missing:")
		}
		return ast.WalkContinue, nil
	})
}

func (a *webApp) render(body, from string, notes []vault.Note) (string, error) {
	// Front matter is properties, not text: show it apart, as written.
	front, body := vault.SplitFrontMatter(body)
	properties := ""
	if front != "" {
		lines := strings.Split(strings.TrimRight(strings.TrimPrefix(front, "\uFEFF"), "\r\n"), "\n")
		inner := strings.Join(lines[1:len(lines)-1], "\n")
		properties = `<pre class="front-matter" aria-label="Properties">` + html.EscapeString(inner) + "</pre>\n"
	}
	resolver := vault.NewResolver(notes)
	links := vault.ParseLinks(body)
	for i := len(links) - 1; i >= 0; i-- {
		l := links[i]
		if image := embedImage(body, l); image != "" {
			body = body[:l.Start-1] + image + body[l.End:]
			continue
		}
		label := l.Alias
		if label == "" {
			label = l.Target
			if l.Heading != "" {
				label += " › " + l.Heading
			}
		}
		target := "/?new=" + url.QueryEscape(l.Target)
		if id, ok := resolver.Resolve(l.Target, from); ok {
			target = "/?note=" + url.QueryEscape(id)
		}
		if l.Heading != "" {
			target += "#" + url.PathEscape(l.Heading)
		}
		label = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]", "*", "\\*", "_", "\\_", "`", "\\`").Replace(label)
		body = body[:l.Start] + "[" + label + "](" + target + ")" + body[l.End:]
	}
	var output bytes.Buffer
	context := parser.NewContext(parser.WithIDs(newHeadingIDs()))
	document := a.renderer.Parser().Parse(text.NewReader([]byte(body)), parser.WithContext(context))
	a.localImages(document, from)
	if err := a.renderer.Renderer().Render(&output, []byte(body), document); err != nil {
		return "", err
	}
	// No remote images in a local notebook: replace other image tags with
	// their alt text so opening a note cannot make a tracking request.
	return properties + suppressImages(output.String()), nil
}

// snippet is the passage of body around the first match of the lower-case
// query q, with whitespace collapsed, or "" when only the note's path matches.
func snippet(body, q string) string {
	text := []rune(strings.Join(strings.Fields(body), " "))
	query := []rune(strings.Join(strings.Fields(q), " "))
	lower := make([]rune, len(text))
	for i, r := range text {
		lower[i] = unicode.ToLower(r)
	}
	at := -1
	for i := 0; i+len(query) <= len(lower) && at < 0; i++ {
		if slices.Equal(lower[i:i+len(query)], query) {
			at = i
		}
	}
	if at < 0 || len(query) == 0 {
		return ""
	}
	start, end := max(0, at-40), min(len(text), at+len(query)+80)
	result := strings.TrimSpace(string(text[start:end]))
	if start > 0 {
		result = "…" + result
	}
	if end < len(text) {
		result += "…"
	}
	return result
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	var api *apiError
	if errors.As(err, &api) {
		writeJSON(w, api.status, map[string]any{"error": api.message, "current": api.current})
		return
	}
	writeJSON(w, 500, map[string]string{"error": err.Error()})
}
