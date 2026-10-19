import type { AppState } from "./types.js";
// Keyboard shortcuts and the note navigation they trigger.
import { $, showError, state } from "./core.js";
import { visibleNotes } from "./list.js";
import { openNote, save, setMode } from "./editor.js";
import {
  deleteDialog,
  helpDialog,
  newNoteDialog,
  renameDialog,
  themeDialog,
} from "./dialogs.js";
import { paletteDialog } from "./palette.js";
import { toggleOutline } from "./outline.js";
import { dailyNote } from "./daily.js";

async function navigate(delta: number) {
  const notes = visibleNotes();
  if (!notes.length) return;
  const index = notes.findIndex((n) => n.id === state.current?.id);
  const next = index < 0
    ? (delta > 0 ? 0 : notes.length - 1)
    : (index + delta + notes.length) % notes.length;
  openNote(notes[next].id).catch(showError);
}
function showNotes() {
  if (window.innerWidth < 800) $("app").classList.add("sidebar-open");
  else $("app").classList.remove("sidebar-hidden", "focus-mode");
}
function findNotes() {
  showNotes();
  $("search").focus();
}
function cycleMode() {
  const modes: AppState["mode"][] = ["write", "source", "preview", "split"];
  setMode(modes[(modes.indexOf(state.mode) + 1) % modes.length]).catch(
    showError,
  );
}
function toggleFocus() {
  $("app").classList.toggle("focus-mode");
  state.source?.refresh();
}
// One table drives both the key handler and the help dialog. Chords name
// "mod" for Ctrl or ⌘; rows without chords are handled by the editors.
interface ShortcutOptions { keepDefault?: boolean }
type Shortcut = [label: string, description: string, chords?: string[], run?: (chord: string) => unknown, options?: ShortcutOptions];
const shortcuts: Shortcut[] = [
  ["Alt N / Ctrl / ⌘ N", "Create note", ["alt+n", "mod+n"], newNoteDialog],
  ["Alt J", "Open today's note", ["alt+j"], () => dailyNote().catch(showError)],
  ["Alt K / Ctrl / ⌘ K", "Quick open a note, heading or command", ["alt+k", "mod+k"], () => paletteDialog()],
  ["Alt S / Ctrl / ⌘ Shift E", "Search note contents", ["alt+s", "mod+shift+e"], findNotes],
  ["Ctrl / ⌘ S", "Save immediately", ["mod+s"], () => save().catch(showError)],
  ["Alt M / Ctrl / ⌘ Shift M", "Cycle writing views", ["alt+m", "mod+shift+m"], cycleMode],
  ["Alt T / Ctrl / ⌘ Shift T", "Choose a theme", ["alt+t", "mod+shift+t"], themeDialog],
  ["Ctrl / ⌘ Shift F", "Focus mode", ["mod+shift+f"], toggleFocus],
  ["Alt O", "Show or hide the outline", ["alt+o"], () => toggleOutline()],
  ["Ctrl / ⌘ Shift R", "Rename or move note", ["mod+shift+r"], renameDialog],
  ["Ctrl / ⌘ Shift D", "Move note to trash", ["mod+shift+d"], deleteDialog],
  ["Alt ↑ / ↓", "Previous / next note", ["alt+arrowup", "alt+arrowdown"],
    (chord) => navigate(chord.endsWith("up") ? -1 : 1)],
  ["Ctrl / ⌘ B, I", "Bold / italic in Write"],
  ["Ctrl / ⌘ Alt 0–6", "Normal text / heading level in Write"],
  ["Ctrl / ⌘ Z", "Undo an edit"],
  ["Ctrl / ⌘ Shift Z", "Redo an edit"],
  ["F1", "Keyboard shortcuts", ["f1"], helpDialog],
  ["Escape", "Close a dialog or the notes drawer", ["escape"],
    () => {
      $("app").classList.remove("sidebar-open");
      if (window.innerWidth < 800 && !$("outline").hidden) toggleOutline(false);
    }, { keepDefault: true }],
];
const shortcutChords = new Map(
  shortcuts.flatMap(([, , chords = [], run, options = {}]) =>
    chords.map((chord) => [chord, { run, options }]),
  ),
);

export { findNotes, navigate, shortcutChords, shortcuts, showNotes, toggleFocus };
