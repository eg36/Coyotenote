// Shared page state, browser storage and the status messages every part uses.
import type { AppError, AppState } from "./types.js";

interface AppElements {
  "brand": HTMLAnchorElement;
  "recent-notes": HTMLButtonElement;
  "commands-button": HTMLButtonElement;
  "pin-note": HTMLButtonElement;
  "clear-folder": HTMLButtonElement;
  "show-all-notes": HTMLButtonElement;
  "document-title": HTMLButtonElement;
  "search": HTMLInputElement;
  "search-all": HTMLButtonElement;
  "search-replacement": HTMLInputElement;
  "search-previous": HTMLButtonElement;
  "search-next": HTMLButtonElement;
  "search-replace": HTMLButtonElement;
  "search-replace-all": HTMLButtonElement;
  "find-replace": HTMLButtonElement;
  "outline-button": HTMLButtonElement;
  "history-button": HTMLButtonElement;
  "export-note": HTMLButtonElement;
  "delete-note": HTMLButtonElement;
  "new-note": HTMLButtonElement;
  "today-note": HTMLButtonElement;
  "sidebar-search": HTMLButtonElement;
  "fold-folders": HTMLButtonElement;
  "tag-filter": HTMLDetailsElement;
  "tags-button": HTMLButtonElement;
  "note-sort": HTMLSelectElement;
  "trash-button": HTMLButtonElement;
  "settings-button": HTMLButtonElement;
  "sidebar-scrim": HTMLButtonElement;
  "sidebar-toggle": HTMLButtonElement;
  "history-back": HTMLButtonElement;
  "block-type": HTMLButtonElement;
  "view-type": HTMLButtonElement;
  "compare-versions": HTMLButtonElement;
  "retry-save": HTMLButtonElement;
  "download-draft": HTMLButtonElement;
  "recovery-copy": HTMLButtonElement;
  "reload-note": HTMLButtonElement;
  "restore-draft": HTMLButtonElement;
  "discard-draft": HTMLButtonElement;
  "review-drafts": HTMLButtonElement;
  "properties-text": HTMLTextAreaElement;
  "first-note": HTMLButtonElement;
  "backlinks-button": HTMLButtonElement;
  "hint-open": HTMLButtonElement;
  "hint-help": HTMLButtonElement;
  "app-version": HTMLAnchorElement;
  "modal": HTMLDialogElement;
  "modal-close": HTMLButtonElement;
  "modal-cancel": HTMLButtonElement;
  "modal-submit": HTMLButtonElement;
  "undo-trash": HTMLButtonElement;
  "toast-close": HTMLButtonElement;
}

// These IDs belong to the static app shell, which is loaded before app.js.
function $<K extends keyof AppElements>(id: K): AppElements[K];
function $(id: string): HTMLElement;
function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing app element: ${id}`);
  return element;
}
const state: AppState = {
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
  saveTimer: undefined,
  previewTimer: undefined,
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
  busy: false,
  tag: "",
  folder: null,
};
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
function showToast(message: string, { undo = false, persistent = false } = {}) {
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
function showError(input: unknown) {
  const error: AppError = input instanceof Error ? input : new Error(String(input));
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
function setSaveState(kind: string, label: string) {
  $("save-state").className = `save-state ${kind}`;
  $("save-label").textContent = label;
  // Wide headers show "Saved" only as a dot; hovering it names the state.
  $("save-state").title = label;
}
function updateCounts() {
  const words = state.body.trim() ? state.body.trim().split(/\s+/).length : 0;
  $("word-count").textContent =
    `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
  $("character-count").textContent =
    `${Array.from(state.body).length.toLocaleString()} characters`;
}

// The notes search opens from the sidebar's search icon; closeSearch hides
// the field when it is empty and not being typed in.
function closeSearch() {
  if ($("search").value || document.activeElement === $("search")) return;
  $("app").classList.remove("search-open");
  $("sidebar-search").setAttribute("aria-expanded", "false");
}
export {
  $,
  clearError,
  closeSearch,
  setSaveState,
  showError,
  showToast,
  state,
  storage,
  updateCounts,
};
