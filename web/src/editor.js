// The open note: editing, saving, loading, views and the formatting toolbar.
import { icon } from "./icons.js";
import {
  $,
  clearError,
  setSaveState,
  showError,
  showToast,
  state,
  storage,
  updateCounts,
} from "./core.js";
import { api } from "./api.js";
import { findDraft, storeDraft, updateOrphans } from "./drafts.js";
import { renderList, revealNote, updateBacklinks } from "./list.js";
import { applyTheme, followWiki } from "./dialogs.js";
import { renderOutline } from "./outline.js";

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
  renderOutline();
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
  updateOrphans();
  return data;
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
  revealNote(note.id);
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
  updateOrphans();
  const url = new URL(location.href);
  url.searchParams.set("note", note.id);
  url.searchParams.delete("new");
  history.replaceState(null, "", url);
  await setMode(state.mode, { focus: false });
  schedulePreview(true);
  renderOutline(true);
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
  updateOrphans();
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
  renderOutline(true);
}
function applyEditability() {
  const editable = !state.pendingDraft && !state.busy;
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
function scrollToHeading(heading) {
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  const target = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
    (el) =>
      el.textContent.toLowerCase() === heading.toLowerCase() ||
      el.id === "h-" + heading.toLowerCase().replace(/ /g, "-"),
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export {
  applyEditability,
  buildBlockMenu,
  changed,
  chooseBlock,
  closeBlockMenu,
  createNote,
  emptyNotebook,
  focusEditor,
  highlightBlock,
  openBlockMenu,
  openNote,
  refresh,
  save,
  schedulePreview,
  setMode,
};
