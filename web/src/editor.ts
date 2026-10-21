import type { AppState, Note, StateResponse } from "./types.js";
// The open note: editing, saving, loading, views and the formatting toolbar.
import { openSearch } from "./search.js";
import { rememberNote, renderNavigation } from "./navigation.js";
import { hydrateIcons, icon } from "./icons.js";
import { setSidebar } from "./sidebar.js";
import {
  $,
  clearError,
  closeSearch,
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
import { renderProperties } from "./properties.js";
import { splitFrontMatter, withProperties } from "./frontmatter.js";
import { addImages, fileUrl, imageFiles } from "./attachments.js";

function changed(body: string, from: "source" | "rich" | "properties") {
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
  document.dispatchEvent(new Event("note-content-change"));
  setSaveState(
    state.dirty ? "dirty" : "saved",
    state.dirty ? "Unsaved changes" : "All changes saved",
  );
  if (from !== "source") state.source?.replace(body);
  schedulePreview();
  renderOutline();
  clearTimeout(state.saveTimer);
  if (state.dirty)
    state.saveTimer = setTimeout(() => save().catch(showError), 400);
}
async function save(): Promise<void> {
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
    const { warning, stamps, ...note } = await api<Note>("/api/note", "PUT", {
      id,
      body,
      revision: base,
    });
    if (warning) showToast(warning, { persistent: true });
    // Only this save changed the vault since the tab last looked, so the
    // change watcher has nothing to fetch.
    if (stamps && stamps[0] === state.stamp) state.stamp = stamps[1];
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
  const changes = state.changes;
  const data = await api<StateResponse>(
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
  state.pluginFolders = data.pluginFolders;
  state.version = data.version;
  const versionLink = $("app-version");
  versionLink.textContent = data.version;
  versionLink.title = `Labradorite ${data.version} · Latest release on GitHub`;
  versionLink.setAttribute("aria-label", versionLink.title);
  versionLink.hidden = false;
  state.notes = data.notes;
  state.stamp = data.stamp;
  // Plugins that show vault files refresh with the notes.
  document.dispatchEvent(new Event("notes-refreshed"));
  if (!state.changing) state.listedChanges = Math.max(state.listedChanges, changes);
  state.filteredIds = query ? new Set(data.matches) : null;
  state.snippets = query ? data.snippets : {};
  state.searched = query;
  // The sidebar shows only the logo; it names the open folder on hover.
  $("brand").title = `Labradorite · ${data.vault}`;
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
  renderNavigation();
  updateBacklinks();
  updateOrphans();
  return data;
}
async function openNote(
  id: string,
  { skipSave = false, heading = "", reveal = true } = {},
) {
  const generation = ++state.openGeneration;
  if (!skipSave) await save();
  const edits = state.edits;
  const note = await api<Note>("/api/note?id=" + encodeURIComponent(id));
  if (generation !== state.openGeneration) return;
  // Typing while the note loaded changed the note still open. Save it
  // first, and stay on it if that fails or if it is the note being loaded,
  // so the response never replaces those edits.
  if (state.edits !== edits) {
    await save();
    if (generation !== state.openGeneration || state.current?.id === id) return;
  }
  if (reveal) revealNote(note.id);
  clearTimeout(state.saveTimer);
  state.current = note;
  rememberNote(note.id);
  state.body = note.body || "";
  state.savedBody = state.body;
  state.dirty = false;
  state.pendingDraft = findDraft(note);
  clearError();
  $("draft-banner").hidden = !state.pendingDraft;
  state.restoring = true;
  state.source?.replace(state.body, { reset: true });
  state.restoring = false;
  $("document-title").textContent = note.title.split("/").pop() || note.title;
  $("document-title").title = note.id;
  $("document-head").hidden = false;
  $("find-replace").disabled = false;
  $("app").classList.remove("at-home");
  $("editor-frame").hidden = false;
  $("editor-area").hidden = false;
  $("empty-state").hidden = true;
  $("note-stats").hidden = false;
  $("view-switch").hidden = false;
  $("app-title").hidden = true;
  if (state.pendingDraft) setSaveState("dirty", "Unsaved draft found");
  else setSaveState("saved", "All changes saved");
  updateCounts();
  renderList();
  renderNavigation();
  updateBacklinks();
  updateOrphans();
  const url = new URL(location.href);
  url.searchParams.set("note", note.id);
  url.searchParams.delete("new");
  history.replaceState(null, "", url);
  await setMode(state.mode, { focus: false, persist: !$("app").classList.contains("search-in-note") });
  schedulePreview(true);
  renderOutline(true);
  document.dispatchEvent(new Event("note-selection-change"));
  // Choosing a note dismisses the phone drawer without changing its preference.
  if (window.innerWidth < 800) setSidebar(false, false);
  if (heading) setTimeout(() => scrollToHeading(heading), 300);
}
// emptyNotebook shows the start page: a new note is one click away, and an
// existing one is in the list beside it.
function emptyNotebook() {
  const hasNotes = state.notes.length > 0;
  $("home-text").textContent = hasNotes
    ? "Pick a note from the list, or start a new one."
    : "Capture a thought. Connect an idea. Make something worth keeping.";
  $("first-note-label").textContent = hasNotes ? "New note" : "Create your first note";
  $("note-stats").hidden = true;
  $("view-switch").hidden = true;
  $("app-title").hidden = false;
  state.current = null;
  renderNavigation();
  state.body = "";
  state.savedBody = "";
  state.dirty = false;
  $("document-head").hidden = true;
  $("find-replace").disabled = true;
  $("app").classList.add("at-home");
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
  document.dispatchEvent(new Event("note-selection-change"));
}
async function createNote(name: string, body = "") {
  await save();
  const note = await api<Note>("/api/note", "POST", { id: name, body });
  state.search = "";
  $("search").value = "";
  closeSearch();
  await refresh();
  await openNote(note.id, { skipSave: true });
  focusEditor();
  return note;
}
async function findInNote(query = "") {
  if (!state.current || state.pendingDraft || state.busy) return;
  await openSearch("note", query || undefined);
}
async function ensureRich() {
  if (!state.rich) {
    const { createRich } = await import("./rich.js");
    state.rich = createRich($("rich-editor"), {
      onChange: (text) => changed((state.front?.prefix || "") + text, "rich"),
      onSelection: updateToolbar,
      onWarning: showToast,
      onWiki: (raw) => followWiki(raw).catch(showError),
      onFiles: addImages,
      fileUrl,
      imageFiles,
    });
  }
  return state.rich;
}
// A view switch waits for the Write editor's code the first time. A newer
// switch made meanwhile, such as clicking Markdown while a note opens,
// wins, and the older one gives up instead of switching back.
let modeGeneration = 0;
async function setMode(mode: AppState["mode"], options: { focus?: boolean; persist?: boolean } = {}) {
  const generation = ++modeGeneration;
  // Busy until the newest switch has finished, so nothing acts on a view
  // that is still being built and focused.
  $("editor-area").setAttribute("aria-busy", "true");
  try {
    await switchMode(mode, generation, options);
  } finally {
    if (generation === modeGeneration) $("editor-area").removeAttribute("aria-busy");
  }
}
async function switchMode(mode: AppState["mode"], generation: number, { focus = true, persist = true } = {}) {
  if (!state.current) {
    state.mode = mode;
    if (persist) storage.set("coyote-view", mode);
    return;
  }
  if (mode === "write") {
    const { supportsRich } = await import("./rich.js");
    if (generation !== modeGeneration || !state.current) return;
    const front = splitFrontMatter(state.body);
    const text = front ? front.rest : state.body;
    const reason = supportsRich(text);
    if (reason) {
      showToast(reason, { persistent: true });
      mode = "source";
    } else {
      const rich = await ensureRich();
      if (generation !== modeGeneration || !state.current) return;
      state.front = front;
      showProperties();
      rich.set(text, state.current.id);
    }
  }
  state.mode = mode;
  if (persist) storage.set("coyote-view", mode);
  $("editor-area").dataset.mode = mode;
  $("source-pane").hidden = !["source", "split"].includes(mode);
  $("rich-pane").hidden = mode !== "write";
  $("preview-pane").hidden = !["preview", "split"].includes(mode);
  $("editor-toolbar").hidden = mode !== "write";
  closeBlockMenu();
  for (const tab of $("view-switch").querySelectorAll<HTMLElement>("[data-view]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === mode));
    tab.tabIndex = tab.dataset.view === mode ? 0 : -1;
  }
  applyEditability();
  state.source?.refresh();
  if (mode === "preview" || mode === "split") schedulePreview(true);
  document.dispatchEvent(new CustomEvent("editor-mode-change", { detail: { userInitiated: focus } }));
  if (focus) focusEditor();
  updateToolbar();
  renderOutline(true);
}
// showProperties fills the properties box with the open note's front matter
// in Write, or hides it when there is none.
function showProperties() {
  const box = $("properties-text");
  $("properties").hidden = !state.front;
  if (state.front && box.value !== state.front.inner) box.value = state.front.inner;
  if (state.front) renderProperties($("properties"), state.front.inner, state.front.fence,
    state.current?.id || "", !state.pendingDraft && !state.busy, editProperties);
  box.style.height = "auto";
  box.style.height = box.scrollHeight + 2 + "px";
}
// editProperties rebuilds the note from the edited properties and its text.
function editProperties(inner: string) {
  const text = state.body.slice(state.front?.prefix.length || 0);
  const body = withProperties(state.front, inner, text);
  state.front = splitFrontMatter(body);
  changed(body, "properties");
  showProperties();
}
function applyEditability() {
  const editable = !state.pendingDraft && !state.busy;
  $("properties-text").readOnly = !editable;
  for (const input of $("properties").querySelectorAll("input")) input.disabled = !editable;
  for (const input of $("rich-editor").querySelectorAll("textarea")) input.readOnly = !editable;
  for (const input of $("rich-editor").querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) input.disabled = !editable;
  for (const select of $("rich-editor").querySelectorAll("select")) select.disabled = !editable;
  state.source?.readOnly(!editable);
  state.rich?.editor?.setEditable(editable, false);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-format], #block-type, #callout-type"))
    button.disabled = !editable;
}
function focusEditor() {
  if (!state.current) return;
  if (state.mode === "write") state.rich?.focus();
  else if (state.mode === "source" || state.mode === "split")
    state.source?.focus();
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
        const data = await api<{ html: string }>("/api/render", "POST", { id, body });
        if (generation === state.previewGeneration) {
          $("preview").innerHTML = data.html;
          const preview = $("preview");
          if (preview.querySelector(".math"))
            import("./preview-math.js").then(({ renderMath }) => {
              if (generation === state.previewGeneration) return renderMath(preview);
            }).catch(() => { if (generation === state.previewGeneration) showToast("Math renderer unavailable. Reload to try again."); });
          if (preview.querySelector("code.language-mermaid"))
            import("./preview-diagrams.js").then(({ renderDiagrams }) => {
              if (generation === state.previewGeneration) return renderDiagrams(preview);
            }).catch(() => { if (generation === state.previewGeneration) showToast("Diagram renderer unavailable. Reload to try again."); });
          hydrateIcons($("preview"));
          decorateLinks();
          decorateTags($("preview"));
        }
      } catch (error) {
        if (generation === state.previewGeneration)
          showToast("Preview unavailable: " + (error instanceof Error ? error.message : String(error)));
      }
    },
    immediate ? 0 : 180,
  );
}
function decorateLinks() {
  $("preview")
    .querySelectorAll("a")
    .forEach((a) => {
      const u = new URL(a.getAttribute("href") || "", location.href);
      if (u.origin !== location.origin) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
}
// decorateTags turns #tags in rendered text into buttons that filter the
// note list, leaving code and links alone.
function decorateTags(root: HTMLElement) {
  const tag = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("code, pre, a, h1, h2, h3, h4, h5, h6")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.data.includes("#")) nodes.push(node);
  }
  for (const node of nodes) {
    const parts = [];
    let last = 0;
    for (const match of node.data.matchAll(tag)) {
      const start = match.index + match[1].length;
      parts.push(node.data.slice(last, start));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag";
      button.dataset.tag = match[2];
      button.textContent = "#" + match[2];
      button.title = "Show notes tagged #" + match[2];
      parts.push(button);
      last = start + match[2].length + 1;
    }
    if (!parts.length) continue;
    parts.push(node.data.slice(last));
    node.replaceWith(...parts);
  }
}
function updateToolbar() {
  const editor = state.rich?.editor;
  if (!editor) return;
  for (const button of document.querySelectorAll<HTMLElement>("[data-format]")) {
    const format = button.dataset.format;
    const colour = button.dataset.colour;
    button.setAttribute("aria-pressed", String(editor.isActive(format || "", colour === undefined ? undefined : { colour })));
  }
  let block = "p";
  for (let level = 1; level <= 6; level++)
    if (editor.isActive("heading", { level })) block = "h" + level;
  state.block = block;
  $("block-type-label").textContent = blockStyles.find(
    ([value]) => value === block,
  )?.[1] || "Normal text";
  for (const option of $("block-menu").querySelectorAll<HTMLElement>("[data-block]"))
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
// closeBlockMenu hides the style list; refocus returns to the writing, or
// to the style button when the list is dismissed with Escape or Tab.
function closeBlockMenu(refocus: boolean | "button" = false) {
  if ($("block-menu").hidden) return;
  $("block-menu").hidden = true;
  $("block-type").setAttribute("aria-expanded", "false");
  if (refocus === "button") $("block-type").focus();
  else if (refocus) state.rich?.focus();
}
function highlightBlock(index: number) {
  const options = [...$("block-menu").children];
  index = (index + options.length) % options.length;
  options.forEach((option, i) => option.classList.toggle("active", i === index));
  $("block-menu").setAttribute("aria-activedescendant", options[index].id);
  options[index].scrollIntoView({ block: "nearest" });
}
function chooseBlock(value: string) {
  closeBlockMenu();
  state.rich?.command("block", value);
}
// The editor view is a segmented switch in the header's right end, in the
// order the views widen: writing, its Markdown, both side by side, the page.
const views: [AppState["mode"], string, string][] = [
  ["write", "Write", "pen"],
  ["source", "Markdown", "code"],
  ["split", "Split", "columns"],
  ["preview", "Preview", "eye"],
];
function buildViewSwitch() {
  $("view-switch").innerHTML = views
    .map(
      ([value, label, iconName]) =>
        `<button type="button" role="tab" id="view-tab-${value}" data-view="${value}" aria-label="${label}" title="${label} · Alt M" aria-selected="${value === state.mode}" tabindex="${value === state.mode ? 0 : -1}">${icon(iconName)}</button>`,
    )
    .join("");
}
// exportNote saves the note, then downloads its Markdown.
async function exportNote() {
  try {
    await save();
    if (!state.current) return;
    const a = document.createElement("a");
    a.href = "/api/export?id=" + encodeURIComponent(state.current.id);
    a.click();
  } catch (error) {
    showError(error);
  }
}
function chooseView(value: string) {
  const view = views.find(([mode]) => mode === value);
  if (view) setMode(view[0]).catch(showError);
}
function scrollToHeading(heading: string) {
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  // A block id: the preview gives the block that id; Write and Markdown show
  // the " ^id" marker at the block's end.
  if (heading.startsWith("^")) {
    const id = heading.slice(1);
    const block =
      root.querySelector(`[id="b-${CSS.escape(id)}"]`) ||
      [...root.querySelectorAll("p,li")].find((el) => (el.textContent || "").trimEnd().endsWith("^" + id));
    block?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  const target = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
    (el) =>
      (el.textContent || "").toLowerCase() === heading.toLowerCase() ||
      el.id === "h-" + heading.toLowerCase().replace(/ /g, "-"),
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export {
  applyEditability,
  buildBlockMenu,
  buildViewSwitch,
  exportNote,
  changed,
  chooseBlock,
  chooseView,
  closeBlockMenu,
  createNote,
  editProperties,
  emptyNotebook,
  findInNote,
  focusEditor,
  highlightBlock,
  openBlockMenu,
  openNote,
  refresh,
  save,
  schedulePreview,
  setMode,
  scrollToHeading,
};
