// Notes, the Markdown notebook, as a plugin of the shell. Its interface is the
// static markup in index.html, so mounting only shows it again.
import { $, showError, state } from "./core.js";
import { draftsDialog } from "./drafts.js";
import { chooseImages } from "./attachments.js";
import { historyDialog } from "./history.js";
import { splitFrontMatter } from "./frontmatter.js";
import { editProperties, exportNote, findInNote, focusEditor, save, setMode } from "./editor.js";
import { backlinksDialog, deleteDialog, newNoteDialog, renameDialog, trashDialog } from "./dialogs.js";
import { toggleOutline } from "./outline.js";
import { findNotes, navigate, toggleFocus } from "./shortcuts.js";
import { dailyNote } from "./daily.js";
import { showRecent, togglePin } from "./navigation.js";
import { registerPlugin, type PluginCommand } from "./plugins.js";

// addProperties starts front matter with a tags field, ready to fill in.
function addProperties() {
  editProperties("tags: ");
  if (state.mode === "write") {
    const box = document.querySelector<HTMLInputElement>(".properties-rows input") || $("properties-text");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

// Commands name what they do; those needing an open note hide without one.
type Definition = [label: string, keys: string, run: () => unknown, needsNote?: boolean, when?: () => unknown];
const definitions: Definition[] = [
  ["New note", "Ctrl N", newNoteDialog],
  ["Search all notes", "Ctrl Shift E", findNotes],
  ["Recently opened notes", "", showRecent],
  ["Pin or unpin this note", "", togglePin, true],
  ["Open today's note", "Alt J", () => dailyNote().catch(showError)],
  ["Rename or move note", "Ctrl Shift R", renameDialog, true],
  ["Move note to trash", "Ctrl Shift D", deleteDialog, true],
  ["Save now", "Ctrl S", () => save().catch(showError), true],
  ["Find and replace in this note", "", () => findInNote().catch(showError), true],
  ["Show notes linking here", "", backlinksDialog, true],
  ["Insert image", "", chooseImages, true],
  ["Add properties (front matter)", "", addProperties, true, () => !splitFrontMatter(state.body)],
  ["Show note history", "", () => historyDialog().catch(showError), true],
  ["Download note as Markdown", "", () => exportNote(), true],
  ["Write view", "", () => setMode("write").catch(showError), true],
  ["Markdown view", "", () => setMode("source").catch(showError), true],
  ["Preview view", "", () => setMode("preview").catch(showError), true],
  ["Split view", "", () => setMode("split").catch(showError), true],
  ["Previous note", "Alt ↑", () => navigate(-1)],
  ["Next note", "Alt ↓", () => navigate(1)],
  ["Toggle focus mode", "Ctrl Shift F", toggleFocus],
  ["Show or hide outline", "Alt O", () => toggleOutline(), true],
  ["Open the trash", "", () => trashDialog().catch(showError)],
  ["Review unsaved drafts", "", draftsDialog, false, () => state.orphans?.length],
];
const commands: PluginCommand[] = definitions.map(([label, keys, run, needsNote = false, when]) => ({
  label,
  keys,
  run,
  when: () => (!needsNote || state.current) && (!when || when()),
}));
const railIds = ["sidebar-toggle", "sidebar-search", "recent-notes", "new-note", "trash-button"];

function registerNotesPlugin() {
  registerPlugin({
    contract: 1,
    id: "notes",
    name: "Notes",
    description: "Markdown notes, links and search",
    icon: "notebook",
    colour: "--plugin-notes",
    fileTypes: [".md"],
    railItems: () => railIds.map((id) => $(id)),
    commands: () => commands,
    mount() {},
    // Leaving Notes saves the open note; everything else stays as it was.
    unmount() {
      save().catch(showError);
    },
    focus() {
      if (state.current && state.mode !== "preview") focusEditor();
      else (state.current ? $("document-title") : $("first-note")).focus();
    },
  });
}

export { registerNotesPlugin };
