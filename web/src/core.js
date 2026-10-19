// Shared page state, browser storage and the status messages every part uses.
const $ = (id) => document.getElementById(id);
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
  busy: false,
  tag: "",
};
let toastTimer = null;
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

export {
  $,
  clearError,
  setSaveState,
  showError,
  showToast,
  state,
  storage,
  updateCounts,
};
