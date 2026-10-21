// The Library lists every file in the vault: notes, the files each plugin
// keeps in its folder, attachments and anything else the folder holds. A
// file opens in the plugin that owns it; files no plugin opens download.
// It belongs to the shell, so it works with every plugin turned off.
import { $, showError, state } from "./core.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { closeModal, openModal } from "./dialogs.js";
import { openWith, plugins } from "./plugins.js";

interface VaultFile { path: string; size: number; modified: string }
interface Listing { files: VaultFile[]; folders: Record<string, string>; attachments: string }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function day(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// kind sorts a file into its group: a plugin's folder, notes, attachments
// or other files.
function kind(file: VaultFile, listing: Listing) {
  for (const [plugin, folder] of Object.entries(listing.folders))
    if (file.path.startsWith(folder + "/")) return plugin;
  if (file.path.startsWith(listing.attachments + "/")) return "attachments";
  return file.path.endsWith(".md") ? "notes" : "other";
}
const enabled = (id: string) => plugins().some((plugin) => plugin.id === id);
// open hands a file to its plugin, else to Notes when it is Markdown, else
// saves it.
async function open(file: VaultFile, group: string) {
  const id = file.path.replace(/\.md$/, "");
  const owner = group === "attachments" || group === "other" ? "" : group;
  if (file.path.endsWith(".md")) {
    if (owner && enabled(owner) && await openWith(owner, id)) return;
    if (enabled("notes")) return openWith("notes", id);
  }
  await download(file);
}
async function download(file: VaultFile) {
  const response = await fetch("/api/download?path=" + encodeURIComponent(file.path), { headers: { "X-Labradorite-Token": state.token } });
  if (!response.ok) throw new Error("This file can no longer be found in the vault.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = file.path.split("/").pop() || "file";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function libraryDialog() {
  const listing = await api<Listing>("/api/library");
  const container = el("div", "library");
  const filter = el("input");
  filter.type = "search";
  filter.placeholder = "Filter by name or folder";
  filter.setAttribute("aria-label", "Filter files by name or folder");
  filter.autocomplete = "off";
  const list = el("div", "library-list");
  const groups: [string, string][] = [
    ["notes", "Notes"],
    ...plugins({ all: true }).filter((p) => listing.folders[p.id]).map((p): [string, string] => [p.id, p.name]),
    ["attachments", "Attachments"],
    ["other", "Other files"],
  ];
  const render = () => {
    const query = filter.value.trim().toLowerCase();
    const shown = listing.files.filter((file) => !query || file.path.toLowerCase().includes(query))
      .sort((a, b) => a.path.localeCompare(b.path));
    list.replaceChildren();
    for (const [group, name] of groups) {
      const files = shown.filter((file) => kind(file, listing) === group);
      if (!files.length) continue;
      const section = el("section", "library-group");
      const heading = el("h3", "library-heading");
      heading.append(el("span", "", name), el("span", "library-count", String(files.length)));
      section.append(heading);
      for (const file of files) {
        const row = el("button", "library-row");
        row.type = "button";
        row.dataset.path = file.path;
        const slash = file.path.lastIndexOf("/");
        const opens = file.path.endsWith(".md") && ((group !== "attachments" && group !== "other" && enabled(group)) || enabled("notes"));
        row.innerHTML = icon(opens ? "note" : "download");
        const text = el("span", "library-name");
        text.append(el("span", "library-file", file.path.slice(slash + 1)), el("span", "library-folder", slash > 0 ? file.path.slice(0, slash) : "Vault"));
        row.append(text, el("span", "library-size", size(file.size)), el("span", "library-date", day(file.modified)));
        row.title = opens ? `Open ${file.path}` : `Download ${file.path}`;
        row.onclick = () => {
          if (opens) closeModal();
          open(file, group).catch(showError);
        };
        section.append(row);
      }
      list.append(section);
    }
    if (!list.children.length) list.append(el("p", "library-empty", query ? "No files match." : "This vault is empty."));
  };
  filter.oninput = render;
  render();
  container.append(filter, list);
  openModal("Library", container, null, { className: "library-dialog", hideFooter: true });
  filter.focus();
}
function openLibrary() {
  libraryDialog().catch(showError);
}

$("library-button").onclick = openLibrary;

export { openLibrary };
