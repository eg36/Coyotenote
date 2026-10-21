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
import { browseFolder, filterTag, renderList, setupDragging, toggleAllFolders, visibleNotes } from "./list.js";
import {
  applyEditability,
  buildBlockMenu,
  buildViewSwitch,
  changed,
  chooseBlock,
  chooseView,
  closeBlockMenu,
  editProperties,
  emptyNotebook,
  findInNote,
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
  followWiki,
  helpDialog,
  linkDialog,
  newNoteDialog,
  openModal,
  renameInPlace,
  trashDialog,
  undoTrash,
} from "./dialogs.js";
import { compareDialog } from "./compare.js";
import { findNotes, shortcutChords } from "./shortcuts.js";
import { paletteDialog } from "./palette.js";
import { setupOutline } from "./outline.js";
import { setupMenus } from "./menus.js";
import { setupRailOrder } from "./rail.js";
import { activePlugin, isActive, startPlugins } from "./plugins.js";
import { registerIssuesPlugin } from "./issues-plugin.js";
import { setupSwitcher } from "./switcher.js";
import { registerNotesPlugin } from "./notes-plugin.js";
import { insertCallout, setupFormatting } from "./formatting.js";
import { historyDialog } from "./history.js";
import { addImages, chooseImages, imageFiles } from "./attachments.js";
import { applyWritingSettings } from "./preferences.js";
import { settingsDialog } from "./settings.js";
import { dailyNote } from "./daily.js";
import { setupTooltips } from "./tooltip.js";
import { setupSearch } from "./search.js";
import { setPinsOpen, showAllNotes, showRecent, togglePin } from "./navigation.js";
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
  // A hidden title row (another plugin is active) measures nothing, so the
  // rail's logo area falls back to its usual height.
  const measureTopbar = () => {
    const height = topbar.getBoundingClientRect().height;
    if (height) $("app").style.setProperty("--topbar-height", `${height}px`);
    else $("app").style.removeProperty("--topbar-height");
  };
  measureTopbar();
  new ResizeObserver(measureTopbar).observe(topbar);
  await claimTab();
  applyWritingSettings();
  hydrateIcons();
  buildBlockMenu();
  buildViewSwitch();
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
    onFind: () => findInNote().catch(showError),
    getNotes: () => state.notes,
    onWarning: (message) => showToast(message, { persistent: true }),
    onFiles: addImages,
    imageFiles,
  });
  setupSearch();
  setupOutline();
  setupDragging();
  setupMenus();
  // Plugins add their rail buttons before the rail order is restored.
  registerNotesPlugin();
  registerIssuesPlugin();
  setupRailOrder();
  setupFormatting();
  setupSwitcher();
  const data = await refresh();
  if (!data) return;
  adoptFormerVault(data.formerVaultIds);
  updateOrphans();
  // The app opens on its start page; a reload keeps the open note, which
  // the address names.
  const requested = new URL(location.href).searchParams.get("note");
  if (requested && state.notes.some((n) => n.id === requested)) {
    const reloading = performance.getEntriesByType("navigation").some(
      (entry) => entry instanceof PerformanceNavigationTiming && entry.type === "reload",
    );
    await openNote(requested, { skipSave: true, reveal: !reloading });
  }
  else emptyNotebook();
  restoreSidebar();
  startPlugins(data.plugins, requested ? "notes" : "");
  if (new URL(location.href).searchParams.has("new")) newNoteDialog();
}
$("new-note").onclick = newNoteDialog;
$("today-note").onclick = () => dailyNote().catch(showError);
// The search icon opens the field, and closes it again (clearing it). The
// field stays open until then, so the list never jumps under the pointer.
$("sidebar-search").onclick = () => {
  if (!$("app").classList.contains("search-open") || $("sidebar-toggle").getAttribute("aria-expanded") !== "true") return findNotes();
  if ($("search").value) {
    $("search").value = "";
    $("search").dispatchEvent(new Event("input"));
  }
  closeSearch();
};
$("fold-folders").onclick = toggleAllFolders;
$("first-note").onclick = newNoteDialog;
$("space-empty-settings").onclick = () => settingsDialog({ plugins: true });
$("document-title").onclick = renameInPlace;
// The logo goes to the start page without reloading.
$("brand").onclick = (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!state.current) return;
  save().then(emptyNotebook).catch(showError);
};
$("note-sort").onchange = () => {
  const sort = $("note-sort").value;
  if (!isSort(sort)) return;
  state.sort = sort;
  storage.set("coyote-sort", state.sort);
  renderList();
};
$("sidebar-toggle").onclick = () => {
  if ($("app").classList.contains("show-recents")) { showAllNotes(); setSidebar(true); }
  else toggleSidebar();
};
$("panel-toggle").onclick = () => toggleSidebar();
$("recent-notes").onclick = showRecent;
$("show-all-notes").onclick = () => { showAllNotes(); browseFolder(null); };
$("clear-folder").onclick = () => browseFolder(null);
$("pin-note").onclick = togglePin;
$("pinned-notes").querySelector("summary")?.addEventListener("click", (event) => {
  event.preventDefault();
  setPinsOpen(!$("pinned-notes").open);
  renderList();
});
$("commands-button").onclick = () => paletteDialog(">");
$("sidebar-scrim").onclick = () => {
  setSidebar(false);
};
$("settings-button").onclick = () => settingsDialog();
$("trash-button").onclick = () => trashDialog().catch(showError);
$("hint-help").onclick = helpDialog;
$("hint-open").onclick = () => paletteDialog();
$("tags-button").onclick = () => {
  $("tag-filter").open = !$("tag-filter").open;
};
$("tag-filter").addEventListener("toggle", () => {
  $("tags-button").setAttribute("aria-expanded", String($("tag-filter").open));
});
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
    else if (name === "callout") insertCallout();
    else if (name === "find") findInNote().catch(showError);
    else if (name === "history") historyDialog().catch(showError);
    else state.rich?.command(name || "", button.dataset.colour);
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
  else if (event.key === "Escape" || event.key === "Tab") closeBlockMenu("button");
  else return;
  event.preventDefault();
  event.stopPropagation();
};
$("block-menu").addEventListener("focusout", () => closeBlockMenu());
addEventListener("resize", () => closeBlockMenu());
// The view switch is a tab list: a click or Enter picks a view, and the
// arrow keys move between views and pick them, as tabs do.
$("view-switch").onmousedown = (e) => e.preventDefault();
$("view-switch").onclick = (event) => {
  const tab = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-view]") : null;
  if (tab) chooseView(tab.dataset.view || "write");
};
$("view-switch").onkeydown = (event) => {
  const tabs = [...$("view-switch").querySelectorAll<HTMLElement>("[data-view]")];
  const index = tabs.findIndex((tab) => tab === document.activeElement);
  const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = tabs[(moves[event.key] + tabs.length) % tabs.length];
  next?.focus();
  chooseView(next?.dataset.view || "write");
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
$("backlinks-button").onclick = backlinksDialog;
$("preview").addEventListener("click", (event) => {
  const tag = event.target instanceof Element ? event.target.closest<HTMLElement>("button.tag") : null;
  if (tag) filterTag(tag.dataset.tag || "");
});
$("preview").onclick = (event) => {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor) return;
  // Links within the note, such as footnotes, scroll the preview without
  // changing the page address.
  const hash = anchor.getAttribute("href") || "";
  if (hash.startsWith("#")) {
    event.preventDefault();
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target && $("preview").contains(target)) target.scrollIntoView({ block: "center" });
    return;
  }
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
    // With Alt held, macOS and some layouts type another character, so
    // letters and digits are read from the key's position.
    event.altKey && /^(Key[A-Z]|Digit\d)$/.test(event.code) ? event.code.slice(-1).toLowerCase() : event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join("+");
  const shortcut = shortcutChords.get(chord);
  // Other plugins handle their own chords; Notes' table rests meanwhile.
  if (!shortcut?.options.shell && !isActive("notes")) {
    if (activePlugin()?.shortcut?.(chord)) event.preventDefault();
    return;
  }
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
// ownChanges is true while this tab's own rename, move, trash or other note
// change is under way or not yet in the list; the stamp then changed here.
const ownChanges = () => state.changing > 0 || state.changes !== state.listedChanges;
async function syncFromDisk() {
  if (!state.ready || syncing || document.hidden || ownChanges()) return;
  syncing = true;
  try {
    const id = state.current?.id,
      before = state.current?.revision;
    await refresh();
    if (
      ownChanges() ||
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
      if (next) await openNote(next.id, { skipSave: true });
      else emptyNotebook();
      showToast(`“${id}” was moved or deleted outside Labradorite.`);
    } else if (summary.revision !== before) {
      await openNote(id, { skipSave: true });
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
  if (!state.ready || syncing || document.hidden || !state.stamp || ownChanges()) return;
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
