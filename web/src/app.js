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
  saveTimer: null,
  previewTimer: null,
  previewGeneration: 0,
  rich: null,
  source: null,
  search: "",
  searchGeneration: 0,
  trash: [],
  back: [],
  pendingDraft: null,
  lastError: null,
  ready: false,
  restoring: false,
};
let modalAction = null,
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

async function api(path, method = "GET", data) {
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
function showError(error) {
  state.lastError = error;
  $("error-text").textContent = error.message || String(error);
  $("error-banner").hidden = false;
  setSaveState("error", "Not saved");
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
  state.body = body;
  state.dirty = body !== state.savedBody;
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
  }
  if (state.dirty) return save();
}
async function refresh({ query = state.search } = {}) {
  const generation = ++state.searchGeneration;
  const data = await api(
    "/api/state" + (query ? "?q=" + encodeURIComponent(query) : ""),
  );
  if (generation !== state.searchGeneration) return;
  state.token = data.token;
  state.vaultId = data.vaultId;
  state.themes = data.themes;
  if (query) {
    state.filteredIds = new Set(data.notes.map((n) => n.id));
    for (const n of data.notes) {
      const old = state.notes.find((item) => item.id === n.id);
      if (old) Object.assign(old, n);
      else state.notes.push(n);
    }
  } else {
    state.notes = data.notes;
    state.filteredIds = null;
  }
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
function excerpt(text) {
  return text
    .replace(/^#+\s*/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*`_]/g, "");
}
function renderList() {
  const notes = state.filteredIds
    ? state.notes.filter((n) => state.filteredIds.has(n.id))
    : state.notes;
  const list = $("note-list");
  list.replaceChildren();
  $("note-count").textContent = notes.length;
  if (!notes.length) {
    const el = document.createElement("p");
    el.className = "list-empty";
    el.textContent = state.search
      ? "No matching notes. Try another thought."
      : "Your next idea starts here.";
    list.append(el);
    return;
  }
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
    head.innerHTML = icon("note");
    const label = document.createElement("span");
    label.textContent = note.title.split("/").pop();
    head.append(label);
    button.append(head);
    const text = document.createElement("span");
    text.className = "note-excerpt";
    text.textContent = excerpt(note.excerpt) || "An empty page, for now.";
    button.append(text);
    const meta = document.createElement("span");
    meta.className = "note-meta";
    const date = new Date(note.modified);
    meta.textContent = `${Number.isNaN(date.valueOf()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${note.words} words`;
    button.append(meta);
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
  const note = await api("/api/note?id=" + encodeURIComponent(id));
  if (generation !== state.openGeneration) return;
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
  $("breadcrumb-name").textContent = note.id;
  $("document-title").textContent = note.title.split("/").pop();
  $("note-folder").textContent = note.id.includes("/")
    ? note.id.split("/").slice(0, -1).join(" / ")
    : "YOUR NOTEBOOK";
  $("document-head").hidden = false;
  $("editor-area").hidden = false;
  $("empty-state").hidden = true;
  setSaveState("saved", "All changes saved");
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
  $("editor-area").hidden = true;
  $("editor-toolbar").hidden = true;
  $("empty-state").hidden = false;
  $("draft-banner").hidden = true;
  $("breadcrumb-name").textContent = "A little room to think";
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
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  const descriptions = {
    write: "Just you and the words.",
    source: "A clear view of the source.",
    preview: "Read it with fresh eyes.",
    split: "The words, and what they become.",
  };
  $("mode-description").textContent = descriptions[mode];
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
  for (let level = 1; level <= 3; level++)
    if (editor.isActive("heading", { level })) block = "h" + level;
  $("block-type").value = block;
}
function updateBacklinks() {
  const note = state.notes.find((n) => n.id === state.current?.id);
  state.currentBacklinks = state.current?.backlinks || note?.backlinks || [];
  $("backlinks-count").textContent = state.currentBacklinks.length;
  $("backlinks-button").disabled = !state.current;
}
function scrollToHeading(heading) {
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  const target = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
    (el) =>
      el.textContent.toLowerCase() === heading.toLowerCase() ||
      el.id === heading.toLowerCase().replace(/ /g, "-"),
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function openModal(
  title,
  content,
  action,
  { submit = "Continue", eyebrow = "COYOTENOTE", hideFooter = false, className = "" } = {},
) {
  $("modal").className = className;
  $("modal-title").textContent = title;
  $("modal-eyebrow").textContent = eyebrow;
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
    "A new beginning",
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
    "Give it a name",
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
    "Let this one go?",
    content,
    async () => {
      await save();
      const id = state.current.id;
      await api("/api/note", "DELETE", {
        id,
        revision: state.current.revision,
      });
      state.trash.push(id);
      storage.remove(draftKey());
      await refresh();
      if (state.notes.length)
        await openNote(state.notes[0].id, { skipSave: true });
      else emptyNotebook();
      showToast("Note moved to trash.", { undo: true });
    },
    { submit: "Move to trash" },
  );
}
async function undoTrash() {
  const id = state.trash.at(-1);
  if (!id) return;
  await save();
  const note = await api("/api/restore", "POST", { id });
  state.trash.pop();
  await refresh();
  await openNote(note.id, { skipSave: true });
  showToast("Note restored.");
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
    input.placeholder = "Find a note…";
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
    openModal("Connect a thought", container, null, { hideFooter: true });
    render();
    return;
  }
  inputDialog(
    "Add a link",
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
    "A thought waiting to happen",
    "Create the linked note",
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
  openModal("Connected thoughts", container, null, {
    eyebrow: "BACKLINKS",
    hideFooter: true,
  });
}
function helpDialog() {
  const container = document.createElement("div");
  container.className = "help-grid";
  const rows = [
    ["Alt N / Ctrl / ⌘ N", "Create note"],
    ["Alt K / Ctrl / ⌘ K", "Find notes"],
    ["Ctrl / ⌘ S", "Save immediately"],
    ["Alt M / Ctrl / ⌘ Shift M", "Cycle writing views"],
    ["Alt T / Ctrl / ⌘ Shift T", "Choose a theme"],
    ["Ctrl / ⌘ Shift F", "Focus mode"],
    ["Ctrl / ⌘ Shift R", "Rename or move note"],
    ["Ctrl / ⌘ Shift D", "Move note to trash"],
    ["Alt ↑ / ↓", "Previous / next note"],
    ["Ctrl / ⌘ B, I", "Bold / italic in Write"],
    ["Ctrl / ⌘ Z", "Undo an edit"],
    ["Ctrl / ⌘ Shift Z", "Redo an edit"],
    ["F1", "Keyboard shortcuts"],
    ["Escape", "Close a dialog or the notes drawer"],
  ];
  for (const [key, description] of rows) {
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
    (state.version || "web alpha");
  container.append(note);
  openModal("A few familiar shortcuts", container, null, {
    eyebrow: "STAY IN THE FLOW",
    hideFooter: true,
  });
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
  state.mode = storage.get("coyote-view") || "write";
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
    await openNote(state.notes[0].id, { skipSave: true });
  else emptyNotebook();
  if (new URL(location.href).searchParams.has("new")) newNoteDialog();
}

$("new-note").onclick = newNoteDialog;
$("first-note").onclick = newNoteDialog;
$("hint-new").onclick = newNoteDialog;
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
  if (!state.notes.length) return;
  const index = state.notes.findIndex((n) => n.id === state.current?.id);
  openNote(
    state.notes[(index + delta + state.notes.length) % state.notes.length].id,
  ).catch(showError);
}
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
$("hint-theme").onclick = themeDialog;
$("help-button").onclick = helpDialog;
$("hint-help").onclick = helpDialog;
$("focus-button").onclick = () => {
  $("app").classList.toggle("focus-mode");
  state.source.refresh();
};
$("hint-search").onclick = () => {
  $("app").classList.add("sidebar-open");
  $("search").focus();
};
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
$("block-type").onchange = () =>
  state.rich?.command("block", $("block-type").value);
$("modal-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!modalAction) return;
  $("modal-submit").disabled = true;
  try {
    await modalAction();
    closeModal();
  } catch (error) {
    $("modal-error").textContent = error.message;
  } finally {
    $("modal-submit").disabled = false;
  }
};
$("modal-close").onclick = closeModal;
$("modal-cancel").onclick = closeModal;
$("modal").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal();
});
$("modal").onclick = (event) => {
  if (event.target === $("modal")) closeModal();
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
    "Reload the disk version?",
    content,
    async () => {
      storage.remove(draftKey());
      const id = state.current.id;
      state.dirty = false;
      await openNote(id, { skipSave: true });
    },
    { submit: "Reload disk version" },
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
  state.rich?.set(state.body, state.current.id);
  state.pendingDraft = null;
  storage.remove(draft.key);
  $("draft-banner").hidden = true;
  applyEditability();
  storeDraft();
  updateCounts();
  schedulePreview(true);
  setSaveState("dirty", "Draft restored · save to keep");
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

document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey,
    key = event.key.toLowerCase();
  if ($("modal").open) return;
  const actions = {
    n: () => newNoteDialog(),
    k: () => {
      $("app").classList.add("sidebar-open");
      $("search").focus();
    },
    s: () => save().catch(showError),
  };
  if (mod && !event.shiftKey && actions[key]) {
    event.preventDefault();
    actions[key]();
    return;
  }
  if (mod && event.shiftKey) {
    const actions = {
      m: () => {
        const modes = ["write", "source", "preview", "split"];
        setMode(modes[(modes.indexOf(state.mode) + 1) % 4]).catch(showError);
      },
      t: themeDialog,
      f: () => {
        $("app").classList.toggle("focus-mode");
        state.source.refresh();
      },
      r: renameDialog,
      d: deleteDialog,
    };
    if (actions[key]) {
      event.preventDefault();
      actions[key]();
      return;
    }
  }
  if (event.altKey && !mod && ["n", "k", "m", "t"].includes(key)) {
    event.preventDefault();
    ({
      n: newNoteDialog,
      k: () => {
        $("app").classList.add("sidebar-open");
        $("search").focus();
      },
      m: () => {
        const modes = ["write", "source", "preview", "split"];
        setMode(modes[(modes.indexOf(state.mode) + 1) % 4]).catch(showError);
      },
      t: themeDialog,
    })[key]();
    return;
  }
  if (event.altKey && (key === "arrowup" || key === "arrowdown")) {
    event.preventDefault();
    navigate(key === "arrowup" ? -1 : 1);
  }
  if (key === "f1") {
    event.preventDefault();
    helpDialog();
  }
  if (key === "escape") {
    $("app").classList.remove("sidebar-open");
  }
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
  }
});
window.addEventListener("online", () => {
  if (state.dirty) save().catch(showError);
});
initialize().catch((error) => {
  showError(error);
  $("empty-state").querySelector("p").textContent =
    "The local notebook could not be opened. Check the message above, then reload.";
});
