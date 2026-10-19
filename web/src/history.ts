interface Version { id: string; time: string; size: number }
// A note's earlier versions: browse them beside the current text and bring
// one back. Restoring keeps the replaced text as a version too.
import { showToast, state } from "./core.js";
import { api } from "./api.js";
import { openNote, save } from "./editor.js";
import { openModal } from "./dialogs.js";
import { changedLines } from "./compare.js";

function when(time: string) {
  const date = new Date(time);
  const today = new Date();
  const day = date.toDateString() === today.toDateString()
    ? "Today"
    : date.toDateString() === new Date(today.valueOf() - 864e5).toDateString()
      ? "Yesterday"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

async function historyDialog() {
  if (!state.current) return;
  await save();
  const id = state.current.id;
  const { versions } = await api<{ versions: Version[] }>("/api/history?id=" + encodeURIComponent(id));
  const container = document.createElement("div");
  const description = document.createElement("p");
  description.className = "dialog-description";
  description.textContent = versions.length
    ? "Earlier versions of this note. Changed lines are marked against the current text."
    : "No earlier versions yet. Labradorite keeps one when a save replaces text, at most every 10 minutes, and always when the file was changed outside the app.";
  container.append(description);
  if (!versions.length) {
    openModal("Note history", container, null, { hideFooter: true });
    return;
  }
  const columns = document.createElement("div");
  columns.className = "history-columns";
  const list = document.createElement("div");
  list.className = "history-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Versions");
  const preview = document.createElement("pre");
  preview.className = "history-preview";
  preview.setAttribute("aria-label", "Version text");
  preview.tabIndex = 0;
  columns.append(list, preview);
  container.append(columns);
  const bodies = new Map<string, string>();
  let chosen: Version | null = null;

  async function choose(version: Version, option: HTMLButtonElement) {
    chosen = version;
    for (const other of list.children) other.setAttribute("aria-selected", String(other === option));
    if (!bodies.has(version.id))
      bodies.set(
        version.id,
        (await api<{ body: string }>(`/api/version?id=${encodeURIComponent(id)}&v=${version.id}`)).body,
      );
    if (chosen !== version) return;
    const lines = (bodies.get(version.id) || "").split("\n");
    const marks = changedLines(lines, state.body.split("\n"));
    preview.replaceChildren();
    for (const [index, text] of lines.entries()) {
      const row = document.createElement("span");
      row.textContent = text + "\n";
      if (marks?.[0][index]) row.className = "changed";
      preview.append(row);
    }
  }
  for (const [index, version] of versions.entries()) {
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "option");
    const label = document.createElement("strong");
    label.textContent = when(version.time);
    const size = document.createElement("small");
    size.textContent = version.size < 1024 ? `${version.size} bytes` : `${(version.size / 1024).toFixed(1)} KB`;
    option.append(label, size);
    option.onclick = () => choose(version, option);
    list.append(option);
    if (index === 0) choose(version, option);
  }
  list.onkeydown = (event) => {
    const options = [...list.querySelectorAll("button")];
    const index = options.findIndex((option) => option === document.activeElement);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : undefined;
    if (next === undefined || !options[next]) return;
    event.preventDefault();
    options[next].focus();
    options[next].click();
  };
  openModal(
    "Note history",
    container,
    async () => {
      if (!chosen || !state.current) return;
      const version = chosen;
      await save();
      await api("/api/history/restore", "POST", {
        id,
        name: version.id,
        revision: state.current.revision,
      });
      await openNote(id, { skipSave: true, pushBack: false });
      showToast(`Restored the version from ${when(version.time)}. The text it replaced is in the history.`);
    },
    { submit: "Restore this version", className: "history" },
  );
}

export { historyDialog };
