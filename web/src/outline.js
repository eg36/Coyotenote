// The open note's headings, for the outline panel and the quick switcher.
import { $, state, storage } from "./core.js";
import { splitFrontMatter } from "./frontmatter.js";

// headings lists a note's Markdown headings outside fenced code, with the
// line each starts on.
function headings(body) {
  const found = [];
  let fence = "";
  // Front matter holds properties, where # starts a comment.
  const front = splitFrontMatter(body);
  const skip = front ? front.prefix.split("\n").length - 1 : 0;
  for (const [index, line] of body.split("\n").entries()) {
    if (index < skip) continue;
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

// headingElements are the rendered headings of the view on screen, or null
// when the Markdown source is shown.
function headingElements() {
  if (state.mode === "source" || state.mode === "split") return null;
  const root = state.mode === "write" ? $("rich-editor") : $("preview");
  return [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
}

// currentHeading is the index of the last heading above the top of the
// view, or -1 above the first one.
function currentHeading(list) {
  const elements = headingElements();
  if (!elements) {
    const top = state.source.topLine();
    return list.findLastIndex((heading) => heading.line <= top);
  }
  const pane = state.mode === "write" ? $("rich-pane") : $("preview-pane");
  const limit = pane.getBoundingClientRect().top + 48;
  return elements.findLastIndex((el) => el.getBoundingClientRect().top <= limit);
}

let outlineTimer = null;
// renderOutline lists the open note's headings in the outline panel, soon
// after typing stops.
function renderOutline(immediate = false) {
  clearTimeout(outlineTimer);
  if ($("outline").hidden) return;
  if (!immediate) {
    outlineTimer = setTimeout(() => renderOutline(true), 250);
    return;
  }
  const list = headings(state.current ? state.body : "");
  const nav = $("outline-list");
  nav.replaceChildren();
  const minimum = Math.min(...list.map((heading) => heading.level));
  for (const [index, heading] of list.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = heading.text
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
      .replace(/[*_`]/g, "");
    button.title = button.textContent;
    button.style.setProperty("--depth", heading.level - minimum);
    button.onclick = () => {
      jumpToHeading(index);
      if (window.innerWidth < 800) toggleOutline(false);
    };
    nav.append(button);
  }
  $("outline-empty").hidden = list.length > 0;
  markCurrent();
}

function markCurrent() {
  if ($("outline").hidden || !state.current) return;
  const index = currentHeading(headings(state.body));
  for (const [i, button] of [...$("outline-list").children].entries())
    button.toggleAttribute("aria-current", i === index);
}

// toggleOutline shows or hides the outline and remembers the choice.
function toggleOutline(open = $("outline").hidden) {
  $("outline").hidden = !open;
  $("outline-button").setAttribute("aria-pressed", String(open));
  $("outline-button").setAttribute("aria-label", open ? "Hide outline" : "Show outline");
  if (window.innerWidth >= 800) storage.set("coyote-outline", open ? "open" : "");
  renderOutline(true);
}

// setupOutline restores the remembered panel and follows scrolling.
function setupOutline() {
  if (storage.get("coyote-outline") === "open" && window.innerWidth >= 800)
    toggleOutline(true);
  let frame = 0;
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(markCurrent);
  };
  for (const id of ["rich-pane", "preview-pane"])
    $(id).addEventListener("scroll", follow, { passive: true });
  state.source.onScroll(follow);
}

export { headings, jumpToHeading, renderOutline, setupOutline, toggleOutline };
