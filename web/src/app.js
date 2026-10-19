// Entry point: starts the app and connects the page's controls.
import { createSource } from "./source.js";
import { hydrateIcons } from "./icons.js";
import {
  $,
  setSaveState,
  showError,
  showToast,
  state,
  storage,
  updateCounts,
} from "./core.js";
import { api } from "./api.js";
import {
  adoptFormerVault,
  claimTab,
  downloadDraft,
  draftKey,
  draftsDialog,
  releaseDraft,
  storeDraft,
  updateOrphans,
} from "./drafts.js";
import { filterTag, renderList, setupDragging, visibleNotes } from "./list.js";
import {
  applyEditability,
  buildBlockMenu,
  changed,
  chooseBlock,
  closeBlockMenu,
  editProperties,
  emptyNotebook,
  highlightBlock,
  openBlockMenu,
  openNote,
  refresh,
  save,
  schedulePreview,
  setMode,
} from "./editor.js";
import {
  backlinksDialog,
  deleteDialog,
  followWiki,
  helpDialog,
  linkDialog,
  newNoteDialog,
  openModal,
  renameDialog,
  themeDialog,
  trashDialog,
  undoTrash,
} from "./dialogs.js";
import { compareDialog } from "./compare.js";
import { navigate, shortcutChords, toggleFocus } from "./shortcuts.js";
import { paletteDialog } from "./palette.js";
import { setupOutline, toggleOutline } from "./outline.js";
import { historyDialog } from "./history.js";
import { setupMenus } from "./menus.js";
import { addImages, chooseImages, imageFiles } from "./attachments.js";
import { applyWritingSettings } from "./preferences.js";

async function initialize() {
  await claimTab();
  applyWritingSettings();
  hydrateIcons();
  buildBlockMenu();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (const key of document.querySelectorAll("kbd[data-keys]"))
    key.textContent = (mac ? "⌘" : "Ctrl ") + key.dataset.keys;
  const searchShortcut = $("search-shortcut");
  searchShortcut.querySelector("[data-modifier]").textContent = mac ? "⌘" : "Ctrl";
  searchShortcut.title = `${mac ? "⌘" : "Ctrl"} + Shift + E`;
  searchShortcut.setAttribute("aria-label", `${mac ? "Command" : "Control"} Shift E`);
  $("search").setAttribute("aria-keyshortcuts", `${mac ? "Meta" : "Control"}+Shift+E`);
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
    onFiles: addImages,
    imageFiles,
  });
  setupOutline();
  setupDragging();
  setupMenus();
  const data = await refresh();
  adoptFormerVault(data.formerVaultIds);
  updateOrphans();
  // The app opens on its start page; a reload keeps the open note, which
  // the address names.
  const requested = new URL(location.href).searchParams.get("note");
  if (requested && state.notes.some((n) => n.id === requested))
    await openNote(requested, { skipSave: true });
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
$("hint-open").onclick = () => paletteDialog();
$("outline-button").onclick = () => toggleOutline();
$("history-button").onclick = () => historyDialog().catch(showError);
$("tag-filter").onchange = () => filterTag($("tag-filter").value);
$("properties-text").oninput = () => editProperties($("properties-text").value);
$("focus-button").onclick = toggleFocus;
for (const button of document.querySelectorAll("[data-mode]"))
  button.onclick = () => setMode(button.dataset.mode).catch(showError);
for (const button of document.querySelectorAll("[data-format]")) {
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () => {
    const name = button.dataset.format;
    if (name === "wiki") linkDialog(true);
    else if (name === "link") linkDialog();
    else if (name === "image") chooseImages();
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
$("download-draft").onclick = () => downloadDraft();
$("review-drafts").onclick = draftsDialog;
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
  releaseDraft(draft.key);
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
  if (state.pendingDraft) releaseDraft(state.pendingDraft.key);
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
$("preview").addEventListener("click", (event) => {
  const tag = event.target.closest("button.tag");
  if (tag) filterTag(tag.dataset.tag);
});
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
      showToast(`“${id}” was moved or deleted outside Labradorite.`);
    } else if (summary.revision !== before) {
      await openNote(id, { skipSave: true, pushBack: false });
      showToast("Reloaded changes made outside Labradorite.");
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
