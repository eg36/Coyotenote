import { createSource } from "./source.js";
import { hydrateIcons, icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const encoder = new TextEncoder();
const state = {
  openGeneration: 0,
  filteredIds: null,
  notes: [],
  themes: [],
  theme: "dark",
  current: null,
  body: "",
  savedBody: "",
  mode: "write",
  token: "",
  vaultId: "",
  dirty: false,
  saving: null,
  savingBody: null,
  saveTimer: null,
  previewTimer: null,
  previewGeneration: 0,
  rich: null,
  source: null,
  search: "",
  sort: "modified",
  searchGeneration: 0,
  trash: [],
  back: [],
  pendingDraft: null,
  block: "p",
  edits: 0,
  lastError: null,
  ready: false,
  restoring: false,
};
let modalAction = null,
  modalBusy = 0,
  toastTimer = null,
  themeOriginal = null;
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
let tabId;
try {
  tabId = sessionStorage.getItem("coyote-tab");
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem("coyote-tab", tabId);
  }
} catch {
  tabId = crypto.randomUUID();
}
const draftPrefix = () => `coyote-draft:${state.vaultId}:`;
const draftKey = () => `${draftPrefix()}${tabId}:${state.current?.id}`;

// A restarted server issues a new token. Renew it once, but only when the
// server still serves this tab's vault, so edits never reach another vault.
async function renewToken() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const session = await response.json();
    if (!response.ok || session.vaultId !== state.vaultId) return false;
    state.token = session.token;
    return true;
  } catch {
    return false;
  }
}
async function api(path, method = "GET", data, retried = false) {
  let response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers:
        method === "GET"
          ? {}
          : {
              "Content-Type": "application/json",
              "X-Coyote-Token": state.token,
            },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error(
      "Cannot reach the local app. Keep this tab open, restart coyotenote, then retry.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The local app returned an unreadable response. Your draft is still kept in this tab.",
    );
  }
  if (!response.ok) {
    if (
      response.status === 403 &&
      method !== "GET" &&
      !retried &&
      (await renewToken())
    )
      return api(path, method, data, true);
    const error = new Error(result.error || "Request failed");
    error.status = response.status;
    error.current = result.current;
    throw error;
  }
  return result;
}

function showToast(message, { undo = false, persistent = false } = {}) {
  clearTimeout(toastTimer);
  $("toast-text").textContent = message;
  $("undo-trash").hidden = !undo;
  $("toast").hidden = false;
  if (!persistent)
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
    }, 6000);
}
// showError explains a failure in the banner. Recovery actions appear only
// while there are unsaved edits, and a conflict leads with comparing versions.
function showError(error) {
  state.lastError = error;
  const conflict =
    error.status === 409 &&
    error.current &&
    error.current.id === state.current?.id;
  const unsaved = Boolean(state.current && state.dirty);
  $("error-title").hidden = conflict || !unsaved;
  $("error-text").textContent = error.message || String(error);
  $("compare-versions").hidden = !conflict;
  $("retry-save").classList.toggle("primary", !conflict);
  $("retry-save").textContent = unsaved ? "Retry save" : "Try again";
  for (const id of ["download-draft", "recovery-copy", "reload-note"])
    $(id).hidden = !unsaved;
  $("error-banner").hidden = false;
  if (unsaved) setSaveState("error", "Not saved");
}
function clearError() {
  state.lastError = null;
  $("error-banner").hidden = true;
}
function setSaveState(kind, label) {
  $("save-state").className = `save-state ${kind}`;
  $("save-label").textContent = label;
}
function updateCounts() {
  const words = state.body.trim() ? state.body.trim().split(/\s+/).length : 0;
  $("word-count").textContent =
    `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
  $("character-count").textContent =
    `${Array.from(state.body).length.toLocaleString()} characters`;
}

function storeDraft() {
  if (!state.current || state.pendingDraft) return;
  if (!state.dirty) {
    storage.remove(draftKey());
    return;
  }
  const ok = storage.set(
    draftKey(),
    JSON.stringify({
      id: state.current.id,
      body: state.body,
      base: state.current.revision,
      time: Date.now(),
    }),
  );
  if (!ok)
    showToast(
      "Browser draft storage is full or unavailable. Keep this tab open until the file is saved.",
      { persistent: true },
    );
}
function findDraft(note) {
  const candidates = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(draftPrefix())) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value.id === note.id && value.body !== note.body)
          candidates.push({ ...value, key });
      } catch {}
    }
  } catch {}
  return candidates.sort((a, b) => b.time - a.time)[0] || null;
}
function changed(body, from) {
  if (state.restoring || !state.current || state.body === body) return;
  state.edits++;
  state.body = body;
  // While a save is on its way, the file may end up holding either version,
  // so only the body being saved can count as saved once it is confirmed.
  state.dirty =
    body !== state.savedBody ||
    (state.savingBody !== null && body !== state.savingBody);
  storeDraft();
  updateCounts();
  setSaveState(
    state.dirty ? "dirty" : "saved",
    state.dirty ? "Unsaved changes" : "All changes saved",
  );
  if (from !== "source") state.source.replace(body);
  schedulePreview();
  clearTimeout(state.saveTimer);
  if (state.dirty)
    state.saveTimer = setTimeout(() => save().catch(showError), 400);
}
async function save() {
  clearTimeout(state.saveTimer);
  if (state.saving) {
    await state.saving;
    if (state.dirty) return save();
    return;
  }
  if (!state.current || !state.dirty) return;
  const id = state.current.id,
    body = state.body,
    base = state.current.revision;
  setSaveState("saving", "Saving…");
  state.savingBody = body;
  state.saving = (async () => {
    const note = await api("/api/note", "PUT", { id, body, revision: base });
    if (state.current?.id !== id) return;
    state.current = { ...state.current, ...note };
    state.savedBody = body;
    state.dirty = state.body !== body;
    const entry = state.notes.find((n) => n.id === id);
    if (entry) Object.assign(entry, note);
    storeDraft();
    clearError();
    setSaveState(
      state.dirty ? "dirty" : "saved",
      state.dirty ? "Unsaved changes" : "All changes saved",
    );
    renderList();
  })();
  try {
    await state.saving;
  } catch (error) {
    storeDraft();
    throw error;
  } finally {
    state.saving = null;
    state.savingBody = null;
  }
  if (state.dirty) return save();
}
async function refresh({ query = state.search } = {}) {
  const generation = ++state.searchGeneration;
  const data = await api(
    "/api/state" + (query ? "?q=" + encodeURIComponent(query) : ""),
  );
  if (generation !== state.searchGeneration) return;
  // A server restarted on another vault must not lend this tab its token,
  // or the open note and drafts would be saved into the wrong vault.
  if (state.vaultId && data.vaultId !== state.vaultId)
    throw new Error(
      "The local app now serves a different vault, so this tab no longer saves. Download any unsaved edits, then reload the page to open that vault.",
    );
  state.token = data.token;
  state.vaultId = data.vaultId;
  state.themes = data.themes;
  state.notes = data.notes;
  state.filteredIds = query ? new Set(data.matches) : null;
  state.snippets = query ? data.snippets : {};
  state.searched = query;
  $("vault-name").textContent = data.vault;
  $("vault-name").title = data.vault;
  if (!state.ready) {
    applyTheme(data.theme);
    state.ready = true;
    if (data.warnings.length)
      showToast(data.warnings.join(" · "), { persistent: true });
  }
  const currentSummary = data.notes.find(
    (note) => note.id === state.current?.id,
  );
  if (currentSummary && state.current)
    state.current.backlinks = currentSummary.backlinks;
  renderList();
  updateBacklinks();
  return data;
}
// excerpt cleans a note's opening text for the list, leaving out a leading
// heading that only repeats the note's title.
function excerpt(text, title = "") {
  const plain = text
    .replace(/^#+\s*/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*`_]/g, "");
  return title && plain.toLowerCase().startsWith(title.toLowerCase() + " ")
    ? plain.slice(title.length + 1)
    : plain;
}
// shortDate names the day a note changed, adding the year only when it is
// not the current one.
function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const options = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}
const noteCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
function visibleNotes() {
  const notes = state.filteredIds
    ? state.notes.filter((note) => state.filteredIds.has(note.id))
    : [...state.notes];
  const folder = (note) => note.id.slice(0, Math.max(0, note.id.lastIndexOf("/")));
  const title = (note) => note.title.split("/").pop();
  return notes.sort((a, b) => {
    // Group folders consistently, then order the notes inside each group.
    const groupOrder =
      noteCollator.compare(folder(a), folder(b)) ||
      folder(a).localeCompare(folder(b));
    if (groupOrder) return groupOrder;
    if (state.sort === "modified") {
      const modifiedOrder =
        (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0);
      if (modifiedOrder) return modifiedOrder;
    }
    const titleOrder = noteCollator.compare(title(a), title(b));
    return (
      (state.sort === "title-desc" ? -titleOrder : titleOrder) ||
      a.id.localeCompare(b.id)
    );
  });
}
// highlight fills element with text, marking each case-insensitive match of
// query. It builds text nodes, so note content never becomes markup.
function highlight(element, text, query) {
  const needle = query.trim().replace(/\s+/g, " ").toLowerCase();
  const lower = text.toLowerCase();
  if (!needle || lower.length !== text.length) {
    element.textContent = text;
    return;
  }
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    element.append(text.slice(from, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + needle.length);
    element.append(mark);
    from = at + needle.length;
  }
  element.append(text.slice(from));
}
function renderList() {
  const notes = visibleNotes();
  const list = $("note-list");
  list.replaceChildren();
  $("note-count").textContent = notes.length;
  if (!notes.length) {
    const el = document.createElement("p");
    el.className = "list-empty";
    el.textContent = state.search
      ? "No matching notes. Try a different word."
      : "No notes yet.";
    list.append(el);
    return;
  }
  list.classList.toggle("searching", Boolean(state.filteredIds));
  let lastFolder = null;
  for (const note of notes) {
    const parts = note.id.split("/");
    parts.pop();
    const folder = parts.join("/");
    if (folder !== lastFolder) {
      const label = document.createElement("div");
      label.className = "folder-group";
      label.innerHTML = icon("folder");
      const name = document.createElement("span");
      name.textContent = folder || "Notebook";
      label.append(name);
      list.append(label);
      lastFolder = folder;
    }
    const button = document.createElement("button");
    button.className =
      "note-row" + (state.current?.id === note.id ? " selected" : "");
    button.dataset.note = note.id;
    button.title = note.id;
    button.setAttribute(
      "aria-current",
      state.current?.id === note.id ? "page" : "false",
    );
    const head = document.createElement("span");
    head.className = "note-row-head";
    const label = document.createElement("span");
    label.className = "note-title";
    label.textContent = note.title.split("/").pop();
    const date = document.createElement("time");
    date.className = "note-date";
    date.textContent = shortDate(note.modified);
    head.append(label, date);
    button.append(head);
    const text = document.createElement("span");
    text.className = "note-excerpt";
    const found = state.filteredIds && state.snippets?.[note.id];
    if (found) highlight(text, found, state.searched);
    else
      text.textContent =
        excerpt(note.excerpt, label.textContent) || "Empty note";
    button.append(text);
    button.onclick = () => openNote(note.id).catch(showError);
    list.append(button);
  }
}

async function openNote(
  id,
  { skipSave = false, pushBack = true, heading = "" } = {},
) {
  const generation = ++state.openGeneration;
  if (!skipSave) await save();
  const edits = state.edits;
  const note = await api("/api/note?id=" + encodeURIComponent(id));
  if (generation !== state.openGeneration) return;
  // Typing while the note loaded changed the note still open. Save it
  // first, and stay on it if that fails or if it is the note being loaded,
  // so the response never replaces those edits.
  if (state.edits !== edits) {
    await save();
    if (generation !== state.openGeneration || state.current?.id === id) return;
  }
  if (pushBack && state.current?.id && state.current.id !== id)
    state.back.push(state.current.id);
  $("history-back").disabled = state.back.length === 0;
  clearTimeout(state.saveTimer);
  state.current = note;
  state.body = note.body || "";
  state.savedBody = state.body;
  state.dirty = false;
  state.pendingDraft = findDraft(note);
  clearError();
  $("draft-banner").hidden = !state.pendingDraft;
  state.restoring = true;
  state.source.replace(state.body, { reset: true });
  state.restoring = false;
  $("document-title").textContent = note.title.split("/").pop();
  $("note-folder").textContent = note.id.split("/").slice(0, -1).join(" / ");
  $("document-head").hidden = false;
  $("document-actions").hidden = false;
  $("editor-frame").hidden = false;
  $("editor-area").hidden = false;
  $("empty-state").hidden = true;
  if (state.pendingDraft) setSaveState("dirty", "Unsaved draft found");
  else setSaveState("saved", "All changes saved");
  updateCounts();
  renderList();
  updateBacklinks();
  const url = new URL(location.href);
  url.searchParams.set("note", note.id);
  url.searchParams.delete("new");
  history.replaceState(null, "", url);
  await setMode(state.mode, { focus: false });
  schedulePreview(true);
  $("app").classList.remove("sidebar-open");
  if (heading) setTimeout(() => scrollToHeading(heading), 300);
}
function emptyNotebook() {
  state.current = null;
  state.body = "";
  state.savedBody = "";
  state.dirty = false;
  $("history-back").disabled = true;
  $("document-head").hidden = true;
  $("document-actions").hidden = true;
  $("editor-frame").hidden = true;
  $("editor-area").hidden = true;
  $("editor-toolbar").hidden = true;
  $("empty-state").hidden = false;
  $("draft-banner").hidden = true;
  history.replaceState(null, "", location.pathname);
  setSaveState("ready", "Ready when you are");
  updateCounts();
  updateBacklinks();
  renderList();
}
async function createNote(name, body = "") {
  await save();
  const note = await api("/api/note", "POST", { id: name, body });
  state.search = "";
  $("search").value = "";
  await refresh();
  await openNote(note.id, { skipSave: true });
  focusEditor();
  return note;
}

function applyTheme(id) {
  const theme = state.themes.find((t) => t.id === id) || state.themes[0];
  if (!theme) return;
  state.theme = theme.id;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.light ? "light" : "dark";
  for (const [role, color] of Object.entries(theme.colors))
    root.style.setProperty("--" + role, color);
  $("theme-name").textContent = theme.name;
}
async function chooseTheme(id) {
  await api("/api/settings", "POST", { theme: id });
  applyTheme(id);
  showToast(
    `${state.themes.find((t) => t.id === id)?.name} · made for this mood`,
  );
}
async function ensureRich() {
  if (!state.rich) {
    const { createRich } = await import("./rich.js");
    state.rich = createRich($("rich-editor"), {
      onChange: (body) => changed(body, "rich"),
      onSelection: updateToolbar,
      onWarning: showToast,
      onWiki: (raw) => followWiki(raw).catch(showError),
    });
  }
  return state.rich;
}
async function setMode(mode, { focus = true } = {}) {
  if (!state.current) {
    state.mode = mode;
    return;
  }
  if (mode === "write") {
    const { supportsRich } = await import("./rich.js");
    const reason = supportsRich(state.body);
    if (reason) {
      showToast(reason, { persistent: true });
      mode = "source";
    } else {
      const rich = await ensureRich();
      rich.set(state.body, state.current.id);
    }
  }
  state.mode = mode;
  storage.set("coyote-view", mode);
  $("editor-area").dataset.mode = mode;
  $("source-pane").hidden = !["source", "split"].includes(mode);
  $("rich-pane").hidden = mode !== "write";
  $("preview-pane").hidden = !["preview", "split"].includes(mode);
  $("editor-toolbar").hidden = mode !== "write";
  closeBlockMenu();
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  applyEditability();
  state.source.refresh();
  if (mode === "preview" || mode === "split") schedulePreview(true);
  if (focus) focusEditor();
  updateToolbar();
}
function applyEditability() {
  const editable = !state.pendingDraft;
  state.source.readOnly(!editable);
  state.rich?.editor?.setEditable(editable, false);
  for (const button of document.querySelectorAll("[data-format], #block-type"))
    button.disabled = !editable;
}
function focusEditor() {
  if (!state.current) return;
  if (state.mode === "write") state.rich?.focus();
  else if (state.mode === "source" || state.mode === "split")
    state.source.focus();
}
function schedulePreview(immediate = false) {
  clearTimeout(state.previewTimer);
  const generation = ++state.previewGeneration;
  if (!state.current || !["preview", "split"].includes(state.mode)) return;
  const body = state.body,
    id = state.current.id;
  state.previewTimer = setTimeout(
    async () => {
      try {
        const data = await api("/api/render", "POST", { id, body });
        if (generation === state.previewGeneration) {
          $("preview").innerHTML = data.html;
          decorateLinks();
        }
      } catch (error) {
        if (generation === state.previewGeneration)
          showToast("Preview unavailable: " + error.message);
      }
    },
    immediate ? 0 : 180,
  );
}
function decorateLinks() {
  $("preview")
    .querySelectorAll("a")
    .forEach((a) => {
      const u = new URL(a.getAttribute("href"), location.href);
      if (u.origin !== location.origin) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
}
function updateToolbar() {
  const editor = state.rich?.editor;
  if (!editor) return;
  for (const button of document.querySelectorAll("[data-format]")) {
    const format = button.dataset.format;
    button.setAttribute("aria-pressed", String(editor.isActive(format)));
  }
  let block = "p";
  for (let level = 1; level <= 6; level++)
    if (editor.isActive("heading", { level })) block = "h" + level;
  state.block = block;
  $("block-type-label").textContent = blockStyles.find(
    ([value]) => value === block,
  )[1];
  for (const option of $("block-menu").children)
    option.setAttribute("aria-selected", String(option.dataset.block === block));
}
// The text style menu previews each style in its own type and names the
// editor's shortcut for it. It floats outside the toolbar, which scrolls.
const blockStyles = [
  ["p", "Normal text"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["h4", "Heading 4"],
  ["h5", "Heading 5"],
  ["h6", "Heading 6"],
];
function buildBlockMenu() {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ ⌥ " : "Ctrl Alt ";
  $("block-menu").innerHTML = blockStyles
    .map(
      ([value, label], index) =>
        `<div class="block-option" role="option" id="block-option-${value}" data-block="${value}" aria-selected="false">${icon("check")}<span class="block-sample">${label}</span><kbd>${mod}${index}</kbd></div>`,
    )
    .join("");
}
function openBlockMenu() {
  const menu = $("block-menu"),
    trigger = $("block-type");
  if (trigger.disabled || !state.rich?.editor) return;
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const box = trigger.getBoundingClientRect();
  menu.style.top = box.bottom + 4 + "px";
  menu.style.left =
    Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.maxHeight = innerHeight - box.bottom - 16 + "px";
  highlightBlock(blockStyles.findIndex(([value]) => value === state.block));
  menu.focus({ preventScroll: true });
}
function closeBlockMenu(refocus = false) {
  if ($("block-menu").hidden) return;
  $("block-menu").hidden = true;
  $("block-type").setAttribute("aria-expanded", "false");
  if (refocus) state.rich?.focus();
}
function highlightBlock(index) {
  const options = [...$("block-menu").children];
  index = (index + options.length) % options.length;
  options.forEach((option, i) => option.classList.toggle("active", i === index));
  $("block-menu").setAttribute("aria-activedescendant", options[index].id);
  options[index].scrollIntoView({ block: "nearest" });
}
function chooseBlock(value) {
  closeBlockMenu();
  state.rich?.command("block", value);
}
function updateBacklinks() {
  const note = state.notes.find((n) => n.id === state.current?.id);
  state.currentBacklinks = state.current?.backlinks || note?.backlinks || [];
  $("backlinks-count").textContent = state.currentBacklinks.length;
  $("backlinks-label").textContent =
    state.currentBacklinks.length === 1 ? "backlink" : "backlinks";
  $("backlinks-button").disabled = !state.current;
}
function scrollToHeading(heading) {
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  const target = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
    (el) =>
      el.textContent.toLowerCase() === heading.toLowerCase() ||
      el.id === "h-" + heading.toLowerCase().replace(/ /g, "-"),
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function openModal(
  title,
  content,
  action,
  { submit = "Continue", hideFooter = false, className = "" } = {},
) {
  $("modal").className = className;
  $("modal-title").textContent = title;
  $("modal-content").replaceChildren(content);
  $("modal-error").textContent = "";
  $("modal-submit").textContent = submit;
  $("modal-footer").hidden = hideFooter;
  modalAction = action;
  $("modal").showModal();
  setTimeout(
    () =>
      (
        $("modal-content").querySelector("input,button,select") ||
        $("modal-close")
      ).focus(),
    30,
  );
}
// A dialog stays open while its action runs, so nothing can be edited or
// opened between the request and the screen catching up with it.
function busyModal(busy) {
  modalBusy += busy ? 1 : -1;
  for (const id of ["modal-submit", "modal-cancel", "modal-close"])
    $(id).disabled = modalBusy > 0;
}
function dismissModal() {
  if (!modalBusy) closeModal();
}
function closeModal() {
  if (themeOriginal) {
    applyTheme(themeOriginal);
    themeOriginal = null;
  }
  $("modal").close();
  modalAction = null;
  focusEditor();
}
function inputDialog(title, label, value, action, options = {}) {
  const container = document.createElement("div");
  const text = document.createElement("label");
  text.className = "field-label";
  text.textContent = label;
  const input = document.createElement("input");
  input.id = "dialog-input";
  input.type = "text";
  input.value = value;
  input.autocomplete = "off";
  input.required = options.required ?? true;
  input.maxLength = 220;
  text.htmlFor = input.id;
  container.append(text, input);
  if (options.description) {
    const description = document.createElement("p");
    description.className = "dialog-description";
    description.textContent = options.description;
    container.append(description);
  }
  openModal(title, container, () => action(input.value.trim()), options);
  setTimeout(() => input.select(), 50);
}
function newNoteDialog() {
  inputDialog(
    "New note",
    "Name your note",
    "",
    (name) => createNote(name),
    {
      submit: "Create note",
      required: false,
      description:
        "Use Folder/Name to keep related notes together. An empty name becomes Untitled.",
    },
  );
}
function renameDialog() {
  if (!state.current) return;
  inputDialog(
    "Rename note",
    "Note path",
    state.current.id,
    async (name) => {
      await save();
      const result = await api("/api/rename", "POST", {
        id: state.current.id,
        name,
        revision: state.current.revision,
      });
      await refresh();
      await openNote(result.note.id, { skipSave: true });
      if (result.warnings.length)
        showToast(result.warnings.join(" · "), { persistent: true });
    },
    {
      submit: "Rename note",
      description:
        "Use a folder path to move this note. Wiki links pointing here are updated.",
    },
  );
}
function deleteDialog() {
  if (!state.current) return;
  const content = document.createElement("p");
  content.className = "dialog-description";
  content.textContent = `Move “${state.current.id}” to the vault’s trash? You can undo this during the current session.`;
  openModal(
    "Move note to trash?",
    content,
    async () => {
      await save();
      const id = state.current.id,
        key = draftKey();
      const { trashId, warning } = await api("/api/note", "DELETE", {
        id,
        revision: state.current.revision,
      });
      state.trash.push({ id, trashId });
      // Edits that never reached the file stay recoverable as a draft.
      if (state.current?.id !== id || !state.dirty) storage.remove(key);
      await refresh();
      const next = visibleNotes()[0] || state.notes[0];
      if (next) await openNote(next.id, { skipSave: true });
      else emptyNotebook();
      showToast(["Note moved to trash.", warning].filter(Boolean).join(" "), {
        undo: true,
      });
    },
    { submit: "Move to trash" },
  );
}
async function undoTrash() {
  const trashed = state.trash.at(-1);
  if (!trashed) return;
  await save();
  const note = await api("/api/restore", "POST", {
    id: trashed.trashId,
    name: trashed.id,
  });
  state.trash.pop();
  await refresh();
  // The open note is still there, so edits typed meanwhile are saved first.
  await openNote(note.id);
  showToast(["Note restored.", note.warning].filter(Boolean).join(" "));
}
async function trashDialog() {
  const { notes } = await api("/api/trash");
  const container = document.createElement("div");
  container.className = "link-list trash-list";
  if (!notes.length) {
    const text = document.createElement("p");
    text.className = "dialog-description";
    text.textContent =
      "The trash is empty. Notes you move to the trash wait here until you restore them.";
    container.append(text);
  }
  for (const note of notes) {
    const row = document.createElement("div");
    row.className = "trash-row";
    const label = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = note.id;
    const detail = document.createElement("small");
    const edited = shortDate(note.modified);
    detail.textContent = [
      edited && "Last edited " + edited,
      excerpt(note.excerpt),
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(name, detail);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.setAttribute("aria-label", "Restore " + note.id);
    restore.onclick = async () => {
      restore.disabled = true;
      busyModal(true);
      try {
        await save();
        const restored = await api("/api/restore", "POST", { id: note.id });
        state.trash = state.trash.filter((item) => item.trashId !== note.id);
        await refresh();
        busyModal(false);
        closeModal();
        await openNote(restored.id);
        showToast(["Note restored.", restored.warning].filter(Boolean).join(" "));
      } catch (error) {
        if (modalBusy) busyModal(false);
        if ($("modal").open) {
          $("modal-error").textContent = error.message;
          restore.disabled = false;
        } else showError(error);
      }
    };
    row.append(label, restore);
    container.append(row);
  }
  openModal("Trash", container, null, { hideFooter: true });
}
function themeDialog() {
  themeOriginal = state.theme;
  const container = document.createElement("div");
  const search = document.createElement("input");
  search.placeholder = "Find a theme…";
  search.setAttribute("aria-label", "Find a theme");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-controls", "theme-list");
  const list = document.createElement("div");
  list.id = "theme-list";
  list.className = "theme-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Themes");
  const empty = document.createElement("p");
  empty.className = "theme-empty";
  empty.setAttribute("role", "status");
  empty.textContent = "No matching themes";
  let active = -1;
  let options = [];
  function activate(index, preview = true, scroll = true) {
    active = index;
    for (const [i, option] of options.entries()) {
      option.classList.toggle("chosen", i === active);
      option.setAttribute("aria-selected", String(i === active));
    }
    const option = options[active];
    if (!option) {
      search.removeAttribute("aria-activedescendant");
      return;
    }
    search.setAttribute("aria-activedescendant", option.id);
    if (preview) applyTheme(option.dataset.themeId);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }
  function render(preview = false) {
    list.replaceChildren();
    options = [];
    for (const theme of state.themes.filter((t) =>
      t.name.toLowerCase().includes(search.value.trim().toLowerCase()),
    )) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-option";
      button.id = "theme-option-" + theme.id;
      button.dataset.themeId = theme.id;
      button.tabIndex = -1;
      button.setAttribute("role", "option");
      const swatch = document.createElement("span");
      swatch.className = "theme-swatch";
      swatch.setAttribute("aria-hidden", "true");
      for (const color of [
        theme.colors.accent,
        theme.colors.pink,
        theme.colors.cyan,
        theme.colors.good,
      ]) {
        const dot = document.createElement("i");
        dot.style.background = color;
        swatch.append(dot);
      }
      const name = document.createElement("strong");
      name.textContent = theme.name;
      const type = document.createElement("small");
      type.textContent = theme.light ? "Light" : "Dark";
      button.append(swatch, name, type);
      const index = options.length;
      button.onmouseenter = () => activate(index, true, false);
      button.onfocus = () => activate(index);
      button.onclick = async () => {
        try {
          await chooseTheme(theme.id);
          themeOriginal = null;
          closeModal();
        } catch (error) {
          $("modal-error").textContent = error.message;
        }
      };
      options.push(button);
      list.append(button);
    }
    empty.hidden = options.length > 0;
    const selected = options.findIndex((option) => option.dataset.themeId === state.theme);
    activate(options.length ? Math.max(0, selected) : -1, preview);
  }
  search.oninput = () => render(true);
  container.onkeydown = (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        activate((active + step + options.length) % options.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      options[active]?.click();
    }
  };
  const searchRow = document.createElement("div");
  searchRow.className = "theme-search";
  searchRow.innerHTML = icon("chevronDown");
  searchRow.prepend(search);
  const hints = document.createElement("p");
  hints.className = "theme-key-hints";
  hints.textContent = "↑↓ preview · Enter select · Esc cancel";
  container.append(searchRow, list, empty, hints);
  openModal("Choose a theme", container, null, {
    className: "theme-picker",
    hideFooter: true,
  });
  render();
}
function linkDialog(wiki = false) {
  if (!state.current) return;
  if (wiki) {
    const container = document.createElement("div");
    const input = document.createElement("input");
    input.placeholder = "Search notes";
    input.setAttribute("aria-label", "Find a note to link");
    const list = document.createElement("div");
    list.className = "link-list";
    function render() {
      list.replaceChildren();
      for (const note of state.notes.filter((n) =>
        n.id.toLowerCase().includes(input.value.toLowerCase()),
      )) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = note.id;
        button.onclick = () => {
          if (state.mode === "write") state.rich.insertWiki(note.id);
          else state.source.insert(`[[${note.id}]]`);
          closeModal();
        };
        list.append(button);
      }
    }
    input.oninput = render;
    container.append(input, list);
    openModal("Link another note", container, null, { hideFooter: true });
    render();
    return;
  }
  inputDialog(
    "Insert link",
    "Web address",
    "https://",
    (url) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Enter a full web address.");
      }
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol))
        throw new Error("Use an http, https or mailto link.");
      if (state.mode === "write") state.rich.command("link", url);
      else state.source.wrap("[", `](${url})`);
    },
    { submit: "Insert link" },
  );
}
async function followWiki(raw) {
  await save();
  const result = await api("/api/resolve", "POST", {
    id: state.current?.id || "",
    body: raw,
  });
  if (result.found) {
    await openNote(result.id, { heading: result.heading });
    return;
  }
  inputDialog(
    "This note doesn’t exist yet",
    "Note name",
    result.target,
    (name) => createNote(name),
    { submit: "Create linked note" },
  );
}
function backlinksDialog() {
  const container = document.createElement("div");
  container.className = "link-list";
  if (!state.currentBacklinks?.length) {
    const text = document.createElement("p");
    text.className = "dialog-description";
    text.textContent =
      "No notes link here yet. Add [[a note name]] in another note to connect them.";
    container.append(text);
  }
  for (const id of state.currentBacklinks || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.onclick = () => {
      closeModal();
      openNote(id).catch(showError);
    };
    container.append(button);
  }
  openModal("Notes linking here", container, null, { hideFooter: true });
}
function helpDialog() {
  const container = document.createElement("div");
  container.className = "help-grid";
  for (const [key, description] of shortcuts) {
    const k = document.createElement("kbd");
    k.textContent = key;
    const label = document.createElement("span");
    label.textContent = description;
    container.append(k, label);
  }
  const note = document.createElement("p");
  note.className = "help-note";
  note.textContent =
    "Browser shortcuts such as Ctrl+T, Ctrl+P, Ctrl+R and Ctrl+W stay with your browser. Use the Shift combinations above for the web app. Local app: " +
    (state.version || "dev");
  container.append(note);
  openModal("Keyboard shortcuts", container, null, { hideFooter: true });
}
// changedLines marks the lines of each text that the other lacks, using a
// longest common subsequence. Very long notes are compared without marks.
function changedLines(a, b) {
  const marks = [a.map(() => false), b.map(() => false)];
  if (a.length * b.length > 4_000_000) return null;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1])
      marks[0][i++] = true;
    else marks[1][j++] = true;
  }
  while (i < a.length) marks[0][i++] = true;
  while (j < b.length) marks[1][j++] = true;
  return marks;
}
function compareDialog() {
  const disk = state.lastError?.current;
  if (!disk || disk.id !== state.current?.id) return;
  const texts = [(disk.body || "").split("\n"), state.body.split("\n")];
  const marks = changedLines(...texts);
  const container = document.createElement("div");
  const description = document.createElement("p");
  description.className = "dialog-description";
  description.textContent =
    "Keeping your edits replaces the disk version. Make a recovery copy first if you want both.";
  const columns = document.createElement("div");
  columns.className = "compare-columns";
  for (const [index, title] of ["On disk", "Your edits"].entries()) {
    const column = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const pre = document.createElement("pre");
    pre.setAttribute("aria-label", title);
    for (const [line, text] of texts[index].entries()) {
      const row = document.createElement("span");
      row.textContent = text + "\n";
      if (marks?.[index][line]) row.className = "changed";
      pre.append(row);
    }
    column.append(heading, pre);
    columns.append(column);
  }
  const useDisk = document.createElement("button");
  useDisk.type = "button";
  useDisk.className = "compare-disk";
  useDisk.textContent = "Use disk version";
  useDisk.onclick = async () => {
    storage.remove(draftKey());
    state.dirty = false;
    closeModal();
    await openNote(disk.id, { skipSave: true }).catch(showError);
  };
  container.append(description, columns, useDisk);
  openModal(
    "Compare versions",
    container,
    async () => {
      state.current = { ...state.current, revision: disk.revision };
      await save();
      showToast("Your edits replaced the disk version.");
    },
    { submit: "Keep my edits", className: "compare" },
  );
}
function downloadDraft() {
  if (!state.current) return;
  const blob = new Blob([state.body], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = state.current.id.split("/").pop() + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function initialize() {
  hydrateIcons();
  buildBlockMenu();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (const key of document.querySelectorAll("kbd[data-keys]"))
    key.textContent = (mac ? "⌘" : "Ctrl ") + key.dataset.keys;
  state.mode = storage.get("coyote-view") || "write";
  const sort = storage.get("coyote-sort");
  if (["modified", "title-asc", "title-desc"].includes(sort)) state.sort = sort;
  $("note-sort").value = state.sort;
  if (!["write", "source", "preview", "split"].includes(state.mode))
    state.mode = "write";
  state.source = createSource($("source-editor"), {
    onChange: (body) => changed(body, "source"),
    getNotes: () => state.notes,
    onWarning: (message) => showToast(message, { persistent: true }),
  });
  const data = await refresh();
  state.version = data.version;
  const requested =
    new URL(location.href).searchParams.get("note") ||
    storage.get("coyote-last:" + state.vaultId);
  if (requested && state.notes.some((n) => n.id === requested))
    await openNote(requested, { skipSave: true });
  else if (state.notes.length)
    await openNote(visibleNotes()[0].id, { skipSave: true });
  else emptyNotebook();
  if (new URL(location.href).searchParams.has("new")) newNoteDialog();
}

$("new-note").onclick = newNoteDialog;
$("first-note").onclick = newNoteDialog;
$("document-title").onclick = renameDialog;
$("delete-note").onclick = deleteDialog;
$("history-back").onclick = async () => {
  const id = state.back.at(-1);
  if (!id) return;
  try {
    await openNote(id, { pushBack: false });
    state.back.pop();
    $("history-back").disabled = state.back.length === 0;
  } catch (error) {
    showError(error);
  }
};
$("previous-note").onclick = () => navigate(-1);
$("next-note").onclick = () => navigate(1);
async function navigate(delta) {
  const notes = visibleNotes();
  if (!notes.length) return;
  const index = notes.findIndex((n) => n.id === state.current?.id);
  const next = index < 0
    ? (delta > 0 ? 0 : notes.length - 1)
    : (index + delta + notes.length) % notes.length;
  openNote(notes[next].id).catch(showError);
}
$("note-sort").onchange = () => {
  state.sort = $("note-sort").value;
  storage.set("coyote-sort", state.sort);
  renderList();
};
let searchTimer;
$("search").oninput = () => {
  state.search = $("search").value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refresh().catch(showError), 120);
};
$("sidebar-toggle").onclick = () => {
  $("app").classList.toggle(
    window.innerWidth < 800 ? "sidebar-open" : "sidebar-hidden",
  );
};
$("sidebar-scrim").onclick = () => {
  $("app").classList.remove("sidebar-open");
};
$("theme-button").onclick = themeDialog;
$("trash-button").onclick = () => trashDialog().catch(showError);
$("hint-help").onclick = helpDialog;
$("focus-button").onclick = toggleFocus;
for (const button of document.querySelectorAll("[data-mode]"))
  button.onclick = () => setMode(button.dataset.mode).catch(showError);
for (const button of document.querySelectorAll("[data-format]")) {
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () => {
    const name = button.dataset.format;
    if (name === "wiki") linkDialog(true);
    else if (name === "link") linkDialog();
    else state.rich?.command(name);
  };
}
$("block-type").onmousedown = (e) => e.preventDefault();
$("block-type").onclick = () =>
  $("block-menu").hidden ? openBlockMenu() : closeBlockMenu(true);
$("block-type").onkeydown = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openBlockMenu();
};
$("block-menu").onmousedown = (e) => e.preventDefault();
$("block-menu").onclick = (event) => {
  const option = event.target.closest("[data-block]");
  if (option) chooseBlock(option.dataset.block);
};
$("block-menu").onmousemove = (event) => {
  const option = event.target.closest("[data-block]");
  if (option && !option.classList.contains("active"))
    highlightBlock([...$("block-menu").children].indexOf(option));
};
$("block-menu").onkeydown = (event) => {
  const options = [...$("block-menu").children];
  const index = options.findIndex((o) => o.classList.contains("active"));
  const moves = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: options.length - 1,
  };
  if (event.key in moves) highlightBlock(moves[event.key]);
  else if (event.key === "Enter" || event.key === " ")
    chooseBlock(options[index].dataset.block);
  else if (event.key === "Escape" || event.key === "Tab") closeBlockMenu(true);
  else return;
  event.preventDefault();
  event.stopPropagation();
};
$("block-menu").addEventListener("focusout", () => closeBlockMenu());
addEventListener("resize", () => closeBlockMenu());
$("modal-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!modalAction || modalBusy) return;
  busyModal(true);
  try {
    await modalAction();
    busyModal(false);
    closeModal();
  } catch (error) {
    busyModal(false);
    $("modal-error").textContent = error.message;
  }
};
$("modal-close").onclick = dismissModal;
$("modal-cancel").onclick = dismissModal;
$("modal").addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissModal();
});
// Browsers close a dialog on a repeated Escape even when cancel is refused.
$("modal").addEventListener("close", () => {
  if (modalBusy) $("modal").showModal();
});
$("modal").onclick = (event) => {
  if (event.target === $("modal")) dismissModal();
};
$("toast-close").onclick = () => {
  $("toast").hidden = true;
};
$("undo-trash").onclick = () => undoTrash().catch(showError);
$("retry-save").onclick = async () => {
  try {
    if (!state.current) {
      location.reload();
      return;
    }
    await refresh();
    await save();
    showToast("All changes saved.");
  } catch (error) {
    showError(error);
  }
};
$("download-draft").onclick = downloadDraft;
$("compare-versions").onclick = compareDialog;
$("recovery-copy").onclick = async () => {
  try {
    const data = await api("/api/recovery", "POST", {
      id: state.current.id,
      body: state.body,
    });
    showToast("Recovery copy saved: " + data.path, { persistent: true });
  } catch (error) {
    showToast(error.message, { persistent: true });
  }
};
$("reload-note").onclick = () => {
  const content = document.createElement("p");
  content.className = "dialog-description";
  content.textContent =
    "Download your edits first if you want to keep them. Reloading replaces this tab’s draft with the current file on disk.";
  openModal(
    "Reload from disk?",
    content,
    async () => {
      storage.remove(draftKey());
      const id = state.current.id;
      state.dirty = false;
      await openNote(id, { skipSave: true });
    },
    { submit: "Reload from disk" },
  );
};
$("restore-draft").onclick = () => {
  const draft = state.pendingDraft;
  if (!draft) return;
  const conflict = draft.base !== state.current.revision;
  state.body = draft.body;
  state.dirty = state.body !== state.savedBody;
  if (conflict) state.current.revision = draft.base;
  state.source.replace(state.body, { reset: true });
  state.pendingDraft = null;
  storage.remove(draft.key);
  $("draft-banner").hidden = true;
  applyEditability();
  storeDraft();
  updateCounts();
  schedulePreview(true);
  setSaveState("dirty", "Restored draft not saved yet");
  // Load the draft into Write through setMode, which keeps a draft with
  // syntax Write cannot round-trip in Markdown instead.
  if (state.mode === "write") setMode("write", { focus: false }).catch(showError);
  if (conflict)
    showToast(
      "The file changed since this draft. Saving will report a conflict; download your edits or make a recovery copy to keep both versions.",
      { persistent: true },
    );
};
$("discard-draft").onclick = () => {
  if (state.pendingDraft) storage.remove(state.pendingDraft.key);
  state.pendingDraft = null;
  $("draft-banner").hidden = true;
  applyEditability();
  setSaveState("saved", "All changes saved");
};
$("export-note").onclick = async () => {
  try {
    await save();
    const a = document.createElement("a");
    a.href = "/api/export?id=" + encodeURIComponent(state.current.id);
    a.click();
  } catch (error) {
    showError(error);
  }
};
$("backlinks-button").onclick = backlinksDialog;
$("preview").onclick = (event) => {
  const anchor = event.target.closest("a[href]");
  if (!anchor) return;
  const u = new URL(anchor.href, location.href);
  if (u.origin === location.origin) {
    if (u.searchParams.has("note")) {
      event.preventDefault();
      openNote(u.searchParams.get("note"), {
        heading: decodeURIComponent(u.hash.slice(1)),
      }).catch(showError);
    } else if (u.searchParams.has("new")) {
      event.preventDefault();
      followWiki(u.searchParams.get("new")).catch(showError);
    }
  }
};

function findNotes() {
  $("app").classList.add("sidebar-open");
  $("search").focus();
}
function cycleMode() {
  const modes = ["write", "source", "preview", "split"];
  setMode(modes[(modes.indexOf(state.mode) + 1) % modes.length]).catch(
    showError,
  );
}
function toggleFocus() {
  $("app").classList.toggle("focus-mode");
  state.source.refresh();
}
// One table drives both the key handler and the help dialog. Chords name
// "mod" for Ctrl or ⌘; rows without chords are handled by the editors.
const shortcuts = [
  ["Alt N / Ctrl / ⌘ N", "Create note", ["alt+n", "mod+n"], newNoteDialog],
  ["Alt K / Ctrl / ⌘ K", "Find notes", ["alt+k", "mod+k"], findNotes],
  ["Ctrl / ⌘ S", "Save immediately", ["mod+s"], () => save().catch(showError)],
  ["Alt M / Ctrl / ⌘ Shift M", "Cycle writing views", ["alt+m", "mod+shift+m"], cycleMode],
  ["Alt T / Ctrl / ⌘ Shift T", "Choose a theme", ["alt+t", "mod+shift+t"], themeDialog],
  ["Ctrl / ⌘ Shift F", "Focus mode", ["mod+shift+f"], toggleFocus],
  ["Ctrl / ⌘ Shift R", "Rename or move note", ["mod+shift+r"], renameDialog],
  ["Ctrl / ⌘ Shift D", "Move note to trash", ["mod+shift+d"], deleteDialog],
  ["Alt ↑ / ↓", "Previous / next note", ["alt+arrowup", "alt+arrowdown"],
    (chord) => navigate(chord.endsWith("up") ? -1 : 1)],
  ["Ctrl / ⌘ B, I", "Bold / italic in Write"],
  ["Ctrl / ⌘ Alt 0–6", "Normal text / heading level in Write"],
  ["Ctrl / ⌘ Z", "Undo an edit"],
  ["Ctrl / ⌘ Shift Z", "Redo an edit"],
  ["F1", "Keyboard shortcuts", ["f1"], helpDialog],
  ["Escape", "Close a dialog or the notes drawer", ["escape"],
    () => $("app").classList.remove("sidebar-open"), { keepDefault: true }],
];
const shortcutChords = new Map(
  shortcuts.flatMap(([, , chords = [], run, options = {}]) =>
    chords.map((chord) => [chord, { run, options }]),
  ),
);
document.addEventListener("keydown", (event) => {
  if ($("modal").open || event.isComposing) return;
  const chord = [
    (event.ctrlKey || event.metaKey) && "mod",
    event.shiftKey && "shift",
    event.altKey && "alt",
    event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join("+");
  const shortcut = shortcutChords.get(chord);
  if (!shortcut) return;
  if (!shortcut.options.keepDefault) event.preventDefault();
  shortcut.run(chord);
});
window.addEventListener("beforeunload", (event) => {
  storeDraft();
  if (state.current)
    storage.set("coyote-last:" + state.vaultId, state.current.id);
  if (state.dirty || state.saving) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    storeDraft();
    save().catch(showError);
  } else syncFromDisk();
});
// Notes may change in other editors while this tab is in the background.
// On return, refresh the list and reload the open note only when it has no
// local edits, so a background change never replaces unsaved work.
let syncing = false;
async function syncFromDisk() {
  if (!state.ready || syncing || document.hidden) return;
  syncing = true;
  try {
    const id = state.current?.id,
      before = state.current?.revision;
    await refresh();
    if (
      !id ||
      state.current?.id !== id ||
      state.current.revision !== before ||
      state.dirty ||
      state.saving ||
      state.pendingDraft
    )
      return;
    const summary = state.notes.find((note) => note.id === id);
    if (!summary) {
      const next = visibleNotes()[0] || state.notes[0];
      if (next) await openNote(next.id, { skipSave: true, pushBack: false });
      else emptyNotebook();
      showToast(`“${id}” was moved or deleted outside coyotenote.`);
    } else if (summary.revision !== before) {
      await openNote(id, { skipSave: true, pushBack: false });
      showToast("Reloaded changes made outside coyotenote.");
    }
  } catch {
    // An unreachable server is reported by the next save instead.
  } finally {
    syncing = false;
  }
}
window.addEventListener("focus", syncFromDisk);
window.addEventListener("online", () => {
  if (state.dirty) save().catch(showError);
});
initialize().catch((error) => {
  showError(error);
  $("empty-state").querySelector("p").textContent =
    "The local notebook could not be opened. Check the message above, then reload.";
});
