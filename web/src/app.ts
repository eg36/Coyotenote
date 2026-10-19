import type { AppState } from "./types.js";
// Entry point: starts the app and connects the page's controls.
import { createSource } from "./source.js";
import { hydrateIcons } from "./icons.js";
import {
  $,
  closeSearch,
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
import { filterTag, renderList, setupDragging, toggleAllFolders, visibleNotes } from "./list.js";
import {
  applyEditability,
  buildBlockMenu,
  buildViewMenu,
  changed,
  chooseBlock,
  chooseView,
  closeBlockMenu,
  closeViewMenu,
  editProperties,
  emptyNotebook,
  findInNote,
  highlightBlock,
  highlightView,
  openBlockMenu,
  openNote,
  openViewMenu,
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
  trashDialog,
  undoTrash,
} from "./dialogs.js";
import { compareDialog } from "./compare.js";
import { findNotes, shortcutChords, showNotes } from "./shortcuts.js";
import { paletteDialog } from "./palette.js";
import { setupOutline, toggleOutline } from "./outline.js";
import { historyDialog } from "./history.js";
import { setupMenus } from "./menus.js";
import { addImages, chooseImages, imageFiles } from "./attachments.js";
import { applyWritingSettings } from "./preferences.js";
import { settingsDialog } from "./settings.js";
import { dailyNote } from "./daily.js";
import { setupTooltips } from "./tooltip.js";
import { restoreSidebar, setSidebar, toggleSidebar } from "./sidebar.js";

function isMode(value: unknown): value is AppState["mode"] {
  return typeof value === "string" && ["write", "source", "preview", "split"].includes(value);
}
function isSort(value: unknown): value is AppState["sort"] {
  return typeof value === "string" && ["modified", "title-asc", "title-desc"].includes(value);
}
async function initialize() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) throw new Error("Missing app top bar");
  const measureTopbar = () => $("app").style.setProperty(
    "--topbar-height", `${topbar.getBoundingClientRect().height}px`,
  );
  measureTopbar();
  new ResizeObserver(measureTopbar).observe(topbar);
  await claimTab();
  applyWritingSettings();
  hydrateIcons();
  buildBlockMenu();
  buildViewMenu();
  setupTooltips();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (const key of document.querySelectorAll<HTMLElement>("kbd[data-keys]"))
    key.textContent = (mac ? "⌘" : "Ctrl ") + key.dataset.keys;
  const searchShortcut = $("search-shortcut");
  const modifier = searchShortcut.querySelector("[data-modifier]");
  if (modifier) modifier.textContent = mac ? "⌘" : "Ctrl";
  searchShortcut.title = `${mac ? "⌘" : "Ctrl"} + Shift + E`;
  searchShortcut.setAttribute("aria-label", `${mac ? "Command" : "Control"} Shift E`);
  $("search").setAttribute("aria-keyshortcuts", `${mac ? "Meta" : "Control"}+Shift+E`);
  const storedMode = storage.get("coyote-view");
  state.mode = isMode(storedMode) ? storedMode : "write";
  const sort = storage.get("coyote-sort");
  if (isSort(sort)) state.sort = sort;
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
  if (!data) return;
  adoptFormerVault(data.formerVaultIds);
  updateOrphans();
  // The app opens on its start page; a reload keeps the open note, which
  // the address names.
  const requested = new URL(location.href).searchParams.get("note");
  if (requested && state.notes.some((n) => n.id === requested))
    await openNote(requested, { skipSave: true });
  else emptyNotebook();
  restoreSidebar();
  if (new URL(location.href).searchParams.has("new")) newNoteDialog();
}
$("new-note").onclick = newNoteDialog;
$("today-note").onclick = () => dailyNote().catch(showError);
// The search icon opens the field, and closes it again (clearing it). The
// field stays open until then, so the list never jumps under the pointer.
$("sidebar-search").onclick = () => {
  if (!$("app").classList.contains("search-open")) return findNotes();
  if ($("search").value) {
    $("search").value = "";
    $("search").dispatchEvent(new Event("input"));
  }
  closeSearch();
};
$("fold-folders").onclick = toggleAllFolders;
$("first-note").onclick = newNoteDialog;
$("document-title").onclick = renameDialog;
$("delete-note").onclick = deleteDialog;
// The logo goes to the start page without reloading, so the back button
// can return to the note that was open.
$("brand").onclick = (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!state.current) return;
  const id = state.current.id;
  save()
    .then(() => {
      state.back.push(id);
      emptyNotebook();
    })
    .catch(showError);
};
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
$("note-sort").onchange = () => {
  const sort = $("note-sort").value;
  if (!isSort(sort)) return;
  state.sort = sort;
  storage.set("coyote-sort", state.sort);
  renderList();
};
let searchTimer: ReturnType<typeof setTimeout> | undefined;
$("search").onfocus = showNotes;
// Keep the search open while its own button takes the click.
$("find-replace").onmousedown = (e) => e.preventDefault();
$("find-replace").onclick = () => {
  const query = $("search").value.trim();
  findInNote(query).catch(showError);
};
$("search").onkeydown = (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  // Escape clears a search first, then closes the empty field.
  if ($("search").value) {
    $("search").value = "";
    $("search").dispatchEvent(new Event("input"));
  } else {
    $("sidebar-search").focus();
    closeSearch();
  }
};
$("search").oninput = () => {
  showNotes();
  state.search = $("search").value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refresh().catch(showError), 120);
};
$("sidebar-toggle").onclick = toggleSidebar;
$("sidebar-scrim").onclick = () => {
  setSidebar(false);
};
$("settings-button").onclick = () => settingsDialog();
$("trash-button").onclick = () => trashDialog().catch(showError);
$("hint-help").onclick = helpDialog;
$("hint-open").onclick = () => paletteDialog();
$("outline-button").onclick = () => toggleOutline();
$("history-button").onclick = () => historyDialog().catch(showError);
$("tag-options").onclick = (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("button[data-tag]") : null;
  if (button) filterTag(button.dataset.tag || "");
};
$("properties-text").oninput = () => editProperties($("properties-text").value);
for (const button of document.querySelectorAll<HTMLElement>("[data-format]")) {
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () => {
    const name = button.dataset.format;
    if (name === "wiki") linkDialog(true);
    else if (name === "link") linkDialog();
    else if (name === "image") chooseImages();
    else state.rich?.command(name || "");
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
  const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-block]") : null;
  if (option) chooseBlock(option.dataset.block || "p");
};
$("block-menu").onmousemove = (event) => {
  const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-block]") : null;
  if (option && !option.classList.contains("active"))
    highlightBlock([...$("block-menu").children].indexOf(option));
};
$("block-menu").onkeydown = (event) => {
  const options = [...$("block-menu").querySelectorAll<HTMLElement>("[data-block]")];
  const index = options.findIndex((o) => o.classList.contains("active"));
  const moves: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: options.length - 1,
  };
  if (event.key in moves) highlightBlock(moves[event.key]);
  else if (event.key === "Enter" || event.key === " ")
    chooseBlock(options[index]?.dataset.block || "p");
  else if (event.key === "Escape" || event.key === "Tab") closeBlockMenu(true);
  else return;
  event.preventDefault();
  event.stopPropagation();
};
$("block-menu").addEventListener("focusout", () => closeBlockMenu());
addEventListener("resize", () => closeBlockMenu());
$("view-type").onmousedown = (e) => e.preventDefault();
$("view-type").onclick = () =>
  $("view-menu").hidden ? openViewMenu() : closeViewMenu(true);
$("view-type").onkeydown = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openViewMenu();
};
$("view-menu").onmousedown = (e) => e.preventDefault();
$("view-menu").onclick = (event) => {
  const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-view]") : null;
  if (option) chooseView(option.dataset.view || "write");
};
$("view-menu").onmousemove = (event) => {
  const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-view]") : null;
  if (option && !option.classList.contains("active"))
    highlightView([...$("view-menu").children].indexOf(option));
};
$("view-menu").onkeydown = (event) => {
  const options = [...$("view-menu").querySelectorAll<HTMLElement>("[data-view]")];
  const index = options.findIndex((o) => o.classList.contains("active"));
  const moves: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: options.length - 1,
  };
  if (event.key in moves) highlightView(moves[event.key]);
  else if (event.key === "Enter" || event.key === " ")
    chooseView(options[index]?.dataset.view || "write");
  else if (event.key === "Escape" || event.key === "Tab") closeViewMenu(true);
  else return;
  event.preventDefault();
  event.stopPropagation();
};
$("view-menu").addEventListener("focusout", () => closeViewMenu());
addEventListener("resize", () => closeViewMenu());
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
    if (!state.current) return;
    const data = await api<{ path: string }>("/api/recovery", "POST", {
      id: state.current.id,
      body: state.body,
    });
    showToast("Recovery copy saved: " + data.path, { persistent: true });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { persistent: true });
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
      if (!state.current) return;
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
  if (!draft || !state.current) return;
  const conflict = draft.base !== state.current.revision;
  state.body = draft.body;
  state.dirty = state.body !== state.savedBody;
  if (conflict) state.current.revision = draft.base;
  state.source?.replace(state.body, { reset: true });
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
    if (!state.current) return;
    a.href = "/api/export?id=" + encodeURIComponent(state.current.id);
    a.click();
  } catch (error) {
    showError(error);
  }
};
$("backlinks-button").onclick = backlinksDialog;
$("preview").addEventListener("click", (event) => {
  const tag = event.target instanceof Element ? event.target.closest<HTMLElement>("button.tag") : null;
  if (tag) filterTag(tag.dataset.tag || "");
});
$("preview").onclick = (event) => {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor) return;
  const u = new URL(anchor.href, location.href);
  if (u.origin === location.origin) {
    if (u.searchParams.has("note")) {
      event.preventDefault();
      openNote(u.searchParams.get("note") || "", {
        heading: decodeURIComponent(u.hash.slice(1)),
      }).catch(showError);
    } else if (u.searchParams.has("new")) {
      event.preventDefault();
      followWiki(u.searchParams.get("new") || "").catch(showError);
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
  shortcut.run?.(chord);
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
// While the tab stays open, a cheap stamp of the vault shows when notes
// changed elsewhere; only then is the list fetched and synced as above.
setInterval(async () => {
  if (!state.ready || syncing || document.hidden || !state.stamp) return;
  try {
    const { stamp } = await api<{ stamp: string }>("/api/stamp");
    if (stamp !== state.stamp) await syncFromDisk();
  } catch {
    // An unreachable server is reported by the next save instead.
  }
}, 3000);
window.addEventListener("online", () => {
  if (state.dirty) save().catch(showError);
});
initialize().catch((error) => {
  showError(error);
  const description = $("empty-state").querySelector("p");
  if (description) description.textContent =
    "The local notebook could not be opened. Check the message above, then reload.";
});
