// Browser drafts: per-tab identity, storing unsaved edits and recovering them.
import { $, showError, showToast, state, storage } from "./core.js";
import { api } from "./api.js";
import { excerpt } from "./list.js";
import { openNote, refresh, save } from "./editor.js";
import { busyModal, closeModal, modalIsBusy, openModal } from "./dialogs.js";

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
// A duplicated tab, or a window opened from this one, copies sessionStorage
// and with it the tab ID. Each page holds a lock named after its ID, so a
// copy finds the ID taken and picks its own, while a reload keeps it.
function holdTab(id) {
  return new Promise((resolve, reject) =>
    navigator.locks
      .request("coyote-tab:" + id, { ifAvailable: true }, (lock) => {
        resolve(Boolean(lock));
        if (lock) return new Promise(() => {});
      })
      .catch(reject),
  );
}
async function claimTab() {
  try {
    if (await holdTab(tabId)) return;
    tabId = crypto.randomUUID();
    try {
      sessionStorage.setItem("coyote-tab", tabId);
    } catch {}
    await holdTab(tabId);
  } catch {
    // Without locks, a copied tab shares drafts as before.
  }
}
async function liveTabs() {
  try {
    const { held } = await navigator.locks.query();
    return new Set(
      held
        .map((lock) => lock.name)
        .filter((name) => name.startsWith("coyote-tab:"))
        .map((name) => name.slice("coyote-tab:".length)),
    );
  } catch {
    return new Set();
  }
}
// Storage keys keep the app's former name, coyote, so drafts and settings
// from before the rename stay where the app looks for them.
const draftPrefix = () => `coyote-draft:${state.vaultId}:`;
// adoptFormerVault refiles drafts and settings kept under IDs the vault had
// at an earlier path, before its folder moved, under its current ID.
function adoptFormerVault(formerIds = []) {
  for (const former of formerIds) {
    if (former === state.vaultId) continue;
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch {}
    for (const key of keys) {
      const match = /^(coyote-[a-z]+):([^:]+)(:.*)?$/.exec(key || "");
      if (!match || match[2] !== former) continue;
      const renamed = `${match[1]}:${state.vaultId}${match[3] || ""}`;
      if (storage.get(renamed) === null) storage.set(renamed, storage.get(key));
      storage.remove(key);
    }
  }
}
const draftKey = () => `${draftPrefix()}${tabId}:${state.current?.id}`;
// releaseDraft forgets a stored draft unless another open tab wrote it:
// that tab still has those edits and the draft is its only stored copy.
async function releaseDraft(key) {
  const owner = key.slice(draftPrefix().length).split(":")[0];
  if (owner === tabId || !(await liveTabs()).has(owner)) storage.remove(key);
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
// orphanDrafts lists stored drafts whose note is gone, renamed or deleted
// outside the app, which opening a note would never find. Drafts written by
// another open tab are left to that tab.
async function orphanDrafts() {
  const ids = new Set(state.notes.map((note) => note.id));
  if (state.current) ids.add(state.current.id);
  const live = await liveTabs();
  const drafts = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(draftPrefix())) continue;
      const owner = key.slice(draftPrefix().length).split(":")[0];
      if (owner !== tabId && live.has(owner)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (!ids.has(value.id)) drafts.push({ ...value, key });
      } catch {}
    }
  } catch {}
  return drafts.sort((a, b) => b.time - a.time);
}
let orphanCheck = 0;
async function updateOrphans() {
  const check = ++orphanCheck;
  const drafts = await orphanDrafts();
  if (check !== orphanCheck) return;
  state.orphans = drafts;
  $("orphan-banner").hidden = !drafts.length;
  $("orphan-title").textContent =
    drafts.length === 1
      ? "An unsaved draft belongs to a note that was moved or deleted."
      : `${drafts.length} unsaved drafts belong to notes that were moved or deleted.`;
}
function downloadDraft(id = state.current?.id, body = state.body) {
  if (!id) return;
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = id.split("/").pop() + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// draftsDialog offers each stranded draft back: as a note under its old
// name, as a downloaded file, or discarded.
function draftsDialog() {
  const container = document.createElement("div");
  container.className = "link-list trash-list";
  const description = document.createElement("p");
  description.className = "dialog-description";
  description.textContent =
    "These edits were never saved, and their note is no longer in the vault. Save one as a note to keep it in the vault.";
  container.append(description);
  for (const draft of state.orphans || []) {
    const row = document.createElement("div");
    row.className = "trash-row draft-row";
    const label = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = draft.id;
    const detail = document.createElement("small");
    detail.textContent = [
      "Edited " +
        new Date(draft.time).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      excerpt(draft.body),
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "draft-actions";
    const button = (text, run) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.setAttribute("aria-label", `${text} ${draft.id}`);
      element.onclick = run;
      actions.append(element);
    };
    button("Save as note", async () => {
      busyModal(true);
      try {
        await save();
        const note = await api("/api/note", "POST", {
          id: draft.id,
          body: draft.body,
        });
        storage.remove(draft.key);
        await refresh();
        busyModal(false);
        closeModal();
        await openNote(note.id);
        showToast("Draft saved as a note.");
      } catch (error) {
        if (modalIsBusy()) busyModal(false);
        if ($("modal").open) $("modal-error").textContent = error.message;
        else showError(error);
      }
    });
    button("Download", () => downloadDraft(draft.id, draft.body));
    button("Discard", async () => {
      storage.remove(draft.key);
      row.remove();
      await updateOrphans();
      if (!state.orphans.length) closeModal();
    });
    row.append(label, actions);
    container.append(row);
  }
  openModal("Unsaved drafts", container, null, { hideFooter: true });
}

export {
  adoptFormerVault,
  claimTab,
  downloadDraft,
  draftKey,
  draftsDialog,
  findDraft,
  releaseDraft,
  storeDraft,
  updateOrphans,
};
