// Comparing local edits with the disk version after a conflict.
import { showError, showToast, state, storage } from "./core.js";
import { draftKey } from "./drafts.js";
import { openNote, save } from "./editor.js";
import { closeModal, openModal } from "./dialogs.js";

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

export { changedLines, compareDialog };
