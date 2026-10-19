package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testApp(t *testing.T) *webApp {
	t.Helper()
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.close)
	app, err := newWebApp(s)
	if err != nil {
		t.Fatal(err)
	}
	app.port = 4280
	return app
}

func request(t *testing.T, a *webApp, method, path string, body any, want int) map[string]any {
	t.Helper()
	var text string
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		text = string(b)
	}
	r := httptest.NewRequest(method, "http://127.0.0.1:4280"+path, strings.NewReader(text))
	r.Header.Set("X-Coyote-Token", a.token)
	r.Header.Set("Origin", "http://127.0.0.1:4280")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("%s %s: status %d want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	result := map[string]any{}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("%s: invalid JSON: %v: %s", path, err, w.Body.String())
	}
	return result
}

func TestNoteLifecycleAndPersistence(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Work/First", Body: "# Hello\n\nworld"}, 201)
	if n["id"] != "Work/First" || n["body"] != "# Hello\n\nworld" {
		t.Fatalf("unexpected note: %v", n)
	}
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Work/First", Body: "Edited\t世界\n", Revision: n["revision"].(string)}, 200)
	disk, err := os.ReadFile(a.store.path("Work/First"))
	if err != nil {
		t.Fatal(err)
	}
	if string(disk) != "Edited\t世界\n" {
		t.Fatalf("disk contents %q", disk)
	}
	got := request(t, a, "GET", "/api/note?id=Work%2FFirst", nil, 200)
	if got["revision"] != n["revision"] {
		t.Fatal("revision did not persist")
	}
	request(t, a, "DELETE", "/api/note", mutation{ID: "Work/First", Revision: n["revision"].(string)}, 200)
	if _, err = os.Stat(a.store.path("Work/First")); !os.IsNotExist(err) {
		t.Fatalf("note was not removed: %v", err)
	}
	restored := request(t, a, "POST", "/api/restore", mutation{ID: "Work/First"}, 200)
	if restored["body"] != "Edited\t世界\n" {
		t.Fatal("trash restore lost data")
	}
	request(t, a, "POST", "/api/note", mutation{ID: "work/first"}, 409)
	report := request(t, a, "GET", "/api/state", nil, 200)
	if len(report["notes"].([]any)) != 1 {
		t.Fatal("unexpected note count")
	}
}

func TestConflictDoesNotOverwriteAndRecovery(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Thought", Body: "original"}, 201)
	if err := os.WriteFile(a.store.path("Thought"), []byte("changed outside"), 0600); err != nil {
		t.Fatal(err)
	}
	error := request(t, a, "PUT", "/api/note", mutation{ID: "Thought", Body: "unsaved local edit", Revision: n["revision"].(string)}, 409)
	if error["current"].(map[string]any)["body"] != "changed outside" {
		t.Fatal("conflict response has no disk version")
	}
	recovered := request(t, a, "POST", "/api/recovery", mutation{ID: "Thought", Body: "unsaved local edit"}, 201)
	copy, err := os.ReadFile(recovered["path"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if string(copy) != "unsaved local edit" {
		t.Fatal("recovery content lost")
	}
	disk, err := os.ReadFile(a.store.path("Thought"))
	if err != nil {
		t.Fatal(err)
	}
	if string(disk) != "changed outside" {
		t.Fatal("external version overwritten")
	}
	request(t, a, "DELETE", "/api/note", mutation{ID: "Thought", Revision: n["revision"].(string)}, 409)
}

func TestLineEndingsPreserved(t *testing.T) {
	a := testApp(t)
	if err := os.WriteFile(a.store.path("Windows"), []byte("hello\r\nworld\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	n := request(t, a, "GET", "/api/note?id=Windows", nil, 200)
	if n["body"] != "hello\nworld\n" {
		t.Fatal("line endings not normalized for browser")
	}
	request(t, a, "PUT", "/api/note", mutation{ID: "Windows", Body: "hello\nchanged\n", Revision: n["revision"].(string)}, 200)
	b, err := os.ReadFile(a.store.path("Windows"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello\r\nchanged\r\n" {
		t.Fatalf("line endings changed: %q", b)
	}
}

func TestRenameRewritesLinksAndBacklinks(t *testing.T) {
	a := testApp(t)
	note := request(t, a, "POST", "/api/note", mutation{ID: "Work/Plan", Body: "# Plan"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Ideas", Body: "[[Work/Plan#Details|project]] and `[[Work/Plan]]`"}, 201)
	state := request(t, a, "GET", "/api/state", nil, 200)
	found := false
	for _, raw := range state["notes"].([]any) {
		n := raw.(map[string]any)
		if n["id"] == "Work/Plan" {
			found = true
			if len(n["backlinks"].([]any)) != 1 {
				t.Fatal("missing backlink")
			}
		}
	}
	if !found {
		t.Fatal("missing note")
	}
	request(t, a, "POST", "/api/rename", mutation{ID: "Work/Plan", Name: "Work/New plan", Revision: note["revision"].(string)}, 200)
	updated := request(t, a, "GET", "/api/note?id=Ideas", nil, 200)
	if updated["body"] != "[[Work/New plan#Details|project]] and `[[Work/Plan]]`" {
		t.Fatalf("wrong link rewrite: %v", updated["body"])
	}
}

func TestThemesMatchMainAndPersist(t *testing.T) {
	a := testApp(t)
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["themes"].([]any)) != 14 {
		t.Fatalf("theme count: %v", state["themes"])
	}
	for _, theme := range themes {
		request(t, a, "POST", "/api/settings", mutation{Theme: theme.id}, 200)
		got := request(t, a, "GET", "/api/state", nil, 200)
		if got["theme"] != theme.id {
			t.Fatalf("theme not persisted: %s", theme.id)
		}
	}
	request(t, a, "POST", "/api/settings", mutation{Theme: "not-a-theme"}, 422)
}

func TestMarkdownRenderingSafety(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "Plan"}, 201)
	source := "# Heading\n\n**bold** and [[Plan#Details|project]].\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![tracker](https://example.com/image.png)\n\n[bad](javascript:alert(1))\n\n```go\nfmt.Println(1)\n```"
	result := request(t, a, "POST", "/api/render", mutation{Body: source, ID: "Other"}, 200)["html"].(string)
	for _, expected := range []string{"<h1", "<strong>bold</strong>", "/?note=Plan", "<table>", "type=\"checkbox\"", "<pre><code", "[image: tracker]"} {
		if !strings.Contains(result, expected) {
			t.Errorf("missing %q in %s", expected, result)
		}
	}
	for _, unsafe := range []string{"<script>", "<img", "href=\"javascript:"} {
		if strings.Contains(result, unsafe) {
			t.Errorf("unsafe markup %q", unsafe)
		}
	}
}

func TestInvalidInputAndFiles(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "../escape"}, 422)
	request(t, a, "POST", "/api/note", mutation{ID: "Good", Body: "kept"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Too big", Body: strings.Repeat("line\n", 10000)}, 422)
	for name, body := range map[string]string{"Invalid": "\xff", "Control": "hello\x1b[31m"} {
		if err := os.WriteFile(a.store.path(name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(a.store.path("Good"), a.store.path("Linked")); err != nil {
		t.Fatal(err)
	}
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["notes"].([]any)) != 1 || len(state["warnings"].([]any)) != 3 {
		t.Fatalf("unsafe files were not skipped: %v", state)
	}
}

func TestLocalRequestProtection(t *testing.T) {
	a := testApp(t)
	for _, tc := range []struct{ host, origin, token string }{
		{"attacker.example:4280", "", a.token},
		{"127.0.0.1:4280", "https://attacker.example", a.token},
		{"127.0.0.1:4280", "http://127.0.0.1:4280", ""},
	} {
		r := httptest.NewRequest("POST", "http://"+tc.host+"/api/note", strings.NewReader(`{"id":"Bad"}`))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-Coyote-Token", tc.token)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("host %s origin %s: status %d", tc.host, tc.origin, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:4280/", nil)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "coyotenote") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("index or protection headers missing")
	}
}

func TestAtomicWriteAndWriterLock(t *testing.T) {
	a := testApp(t)
	if second, err := openStore(a.store.dir); err == nil {
		second.close()
		t.Fatal("second vault writer allowed")
	}
	n, err := a.store.create("Safe", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		body := fmt.Sprintf("revision %d", i)
		if err = a.store.save(n, body); err != nil {
			t.Fatal(err)
		}
		n.Body = body
	}
	entries, err := os.ReadDir(a.store.dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".pending-") {
			t.Fatal("temporary write leaked")
		}
	}
	if err = os.WriteFile(filepath.Join(a.store.dir, ".pending-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	notes, report, err := a.store.load()
	if err != nil || report.orphans != 1 || notes[0].Body != "revision 3" {
		t.Fatalf("recovery: %v %+v %v", notes, report, err)
	}
}

func TestTrashKeepsNotesWithRepeatedNames(t *testing.T) {
	a := testApp(t)
	trashIDs := []string{}
	for _, body := range []string{"first", "second", "third"} {
		n := request(t, a, "POST", "/api/note", mutation{ID: "Folder/Dup", Body: body}, 201)
		trashed := request(t, a, "DELETE", "/api/note", mutation{ID: "Folder/Dup", Revision: n["revision"].(string)}, 200)
		trashIDs = append(trashIDs, trashed["trashId"].(string))
	}
	if strings.Join(trashIDs, ",") != "Folder/Dup,Folder/Dup 2,Folder/Dup 3" {
		t.Fatalf("trash names %v", trashIDs)
	}
	for i, body := range []string{"first", "second", "third"} {
		b, err := os.ReadFile(filepath.Join(a.store.dir, ".trash", filepath.FromSlash(trashIDs[i])+".md"))
		if err != nil || string(b) != body {
			t.Fatalf("trashed %s = %q, %v", trashIDs[i], b, err)
		}
	}
	restored := request(t, a, "POST", "/api/restore", mutation{ID: "Folder/Dup 2", Name: "Folder/Dup"}, 200)
	if restored["id"] != "Folder/Dup" || restored["body"] != "second" {
		t.Fatalf("restored %v", restored)
	}
	request(t, a, "POST", "/api/restore", mutation{ID: "Folder/Dup 3", Name: "Folder/Dup"}, 409)
}

func TestHeadingIDsCannotShadowAppElements(t *testing.T) {
	a := testApp(t)
	result := request(t, a, "POST", "/api/render", mutation{Body: "# Modal\n## Word count\n## Word count\n# ¿Qué tal?\n# !!!", ID: "Other"}, 200)["html"].(string)
	for _, expected := range []string{`id="h-modal"`, `id="h-word-count"`, `id="h-word-count-1"`, `id="h-qué-tal"`, `id="h-heading"`} {
		if !strings.Contains(result, expected) {
			t.Errorf("missing %s in %s", expected, result)
		}
	}
	for _, shadow := range []string{`id="modal"`, `id="word-count"`} {
		if strings.Contains(result, shadow) {
			t.Errorf("heading took app element %s", shadow)
		}
	}
}

func TestSearchReportsMatchesAlongsideEveryNote(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/api/note", mutation{ID: "Garden", Body: "Tomatoes and basil"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Work/Basil plan", Body: "Quarterly"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Other", Body: "Nothing here"}, 201)
	state := request(t, a, "GET", "/api/state?q=BASIL", nil, 200)
	if len(state["notes"].([]any)) != 3 {
		t.Fatalf("search should still list every note: %v", state["notes"])
	}
	if got := fmt.Sprint(state["matches"]); got != "[Garden Work/Basil plan]" {
		t.Fatalf("matches %s", got)
	}
	if state := request(t, a, "GET", "/api/state", nil, 200); state["matches"] != nil {
		t.Fatalf("unfiltered state reported matches %v", state["matches"])
	}
}

func TestSessionRenewsTokenForTheSameVaultOnly(t *testing.T) {
	a := testApp(t)
	session := request(t, a, "GET", "/api/session", nil, 200)
	state := request(t, a, "GET", "/api/state", nil, 200)
	if session["token"] != a.token || session["vaultId"] != state["vaultId"] {
		t.Fatalf("session %v does not match state", session)
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:4280/api/session", nil)
	r.Header.Set("Origin", "https://attacker.example")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden || strings.Contains(w.Body.String(), a.token) {
		t.Fatalf("cross-origin session request: %d %s", w.Code, w.Body.String())
	}
}

func TestLoadCacheNeverServesStaleText(t *testing.T) {
	a := testApp(t)
	n := request(t, a, "POST", "/api/note", mutation{ID: "Cached", Body: "aaa"}, 201)
	p := a.store.path("Cached")
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	// A coarse file system can give a quick same-size save the same time.
	n = request(t, a, "PUT", "/api/note", mutation{ID: "Cached", Body: "bbb", Revision: n["revision"].(string)}, 200)
	if err = os.Chtimes(p, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got := request(t, a, "GET", "/api/note?id=Cached", nil, 200); got["body"] != "bbb" || got["revision"] != n["revision"] {
		t.Fatalf("own save served stale text: %v", got)
	}
	if err = os.WriteFile(p, []byte("changed outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := request(t, a, "GET", "/api/note?id=Cached", nil, 200); got["body"] != "changed outside" {
		t.Fatalf("outside change missed: %v", got)
	}
	if err = os.WriteFile(p, []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	state := request(t, a, "GET", "/api/state", nil, 200)
	if len(state["notes"].([]any)) != 0 || !strings.Contains(fmt.Sprint(state["warnings"]), "Cached.md (not UTF-8)") {
		t.Fatalf("invalid file was not skipped: %v", state)
	}
}

func TestMovesRemoveFoldersTheyLeaveEmpty(t *testing.T) {
	a := testApp(t)
	exists := func(rel string) bool {
		_, err := os.Stat(filepath.Join(a.store.dir, filepath.FromSlash(rel)))
		return err == nil
	}
	n := request(t, a, "POST", "/api/note", mutation{ID: "A/B/Moved"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Keep/Sibling"}, 201)
	request(t, a, "POST", "/api/note", mutation{ID: "Keep/Deep/Leaving"}, 201)
	request(t, a, "POST", "/api/rename", mutation{ID: "A/B/Moved", Name: "Top", Revision: n["revision"].(string)}, 200)
	if exists("A") {
		t.Fatal("renaming left empty folders behind")
	}
	leaving := request(t, a, "GET", "/api/note?id=Keep%2FDeep%2FLeaving", nil, 200)
	request(t, a, "DELETE", "/api/note", mutation{ID: "Keep/Deep/Leaving", Revision: leaving["revision"].(string)}, 200)
	if exists("Keep/Deep") || !exists("Keep/Sibling.md") {
		t.Fatal("trash pruned the wrong folders")
	}
	request(t, a, "POST", "/api/restore", mutation{ID: "Keep/Deep/Leaving"}, 200)
	if exists(".trash/Keep") || !exists(".trash") || !exists("Keep/Deep/Leaving.md") {
		t.Fatal("restore did not tidy the trash folders")
	}
}
