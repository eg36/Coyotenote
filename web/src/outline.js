// The open note's headings, for the outline panel and the quick switcher.
import { $, state } from "./core.js";

// headings lists a note's Markdown headings outside fenced code, with the
// line each starts on.
function headings(body) {
  const found = [];
  let fence = "";
  for (const [index, line] of body.split("\n").entries()) {
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      if (!fence) fence = opening[1];
      else if (opening[1][0] === fence[0] && opening[1].length >= fence.length)
        fence = "";
      continue;
    }
    const heading = !fence && /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading)
      found.push({ level: heading[1].length, text: heading[2], line: index + 1 });
  }
  return found;
}

// jumpToHeading brings the open note's heading at index into view in
// whichever view shows it.
function jumpToHeading(index) {
  const heading = headings(state.current ? state.body : "")[index];
  if (!heading) return;
  if (state.mode === "source" || state.mode === "split") {
    state.source.goToLine(heading.line);
    return;
  }
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  root
    .querySelectorAll("h1, h2, h3, h4, h5, h6")
    [index]?.scrollIntoView({ block: "start" });
}

export { headings, jumpToHeading };
