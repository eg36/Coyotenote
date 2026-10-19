// A daily note is an ordinary Markdown file, dated in the writer's timezone.
import { state } from "./core.js";
import { applyEditability, createNote, openNote, refresh, save } from "./editor.js";

let opening = null;
function dailyNote() {
  if (opening) return opening;
  if (state.busy) return Promise.resolve();
  opening = (async () => {
    state.busy = true;
    applyEditability();
    try {
      await save();
      const now = new Date();
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      const id = "Journal/" + date;
      await refresh();
      let existing = state.notes.find((n) => n.id.toLowerCase() === id.toLowerCase());
      if (existing) return await openNote(existing.id);
      try {
        return await createNote(id);
      } catch (error) {
        // Another tab may have created today's note after our refresh.
        if (error.status !== 409) throw error;
        await refresh();
        existing = state.notes.find((n) => n.id.toLowerCase() === id.toLowerCase());
        if (!existing) throw error;
        return await openNote(existing.id);
      }
    } finally {
      state.busy = false;
      applyEditability();
    }
  })().finally(() => { opening = null; });
  return opening;
}

export { dailyNote };
