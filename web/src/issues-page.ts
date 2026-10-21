// The issue page shows one issue the way a note reads: its title, a row of
// property chips that open small menus, the rendered text with its "Done
// when" boxes, and the notes it links with. Every change rewrites only the
// part of the file it touches.
import { $, showError } from "./core.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { showMenu, type MenuEntry } from "./menus.js";
import { splitFrontMatter } from "./frontmatter.js";
import { inputDialog } from "./dialogs.js";
import {
  parseIssue,
  priorities,
  priorityName,
  saveIssue,
  setField,
  statusName,
  statuses,
  type Issue,
} from "./issues-data.js";

interface PageHost {
  projects(): string[];
  labels(): string[];
  colourOf(name: string): string;
  changed(issue: Issue): void; // the issue was saved
  closed(file: string): void; // the page closed; the overview shows again
  openNote(id: string): void;
}

let host: PageHost;
let shown: Issue | null = null;
// The chip whose menu is open, so focus returns to it after a choice.
let menuChip = "";
let generation = 0;
const page = () => $("issues-page");
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

// The "Done when" section is a heading of that name and the task lines
// below it, up to the next heading.
interface Task { at: number; done: boolean; text: string }
function doneWhen(body: string) {
  const front = splitFrontMatter(body);
  const offset = front ? front.prefix.length : 0;
  const lines = (front ? front.rest : body).split("\n");
  const tasks: Task[] = [];
  let inside = false, start = -1, end = lines.length, at = offset;
  for (const [index, line] of lines.entries()) {
    if (/^#{1,6}\s/.test(line)) {
      if (inside) { end = index; break; }
      if (/^#{1,6}\s+Done when\s*$/i.test(line)) { inside = true; start = index; }
    } else if (inside) {
      const task = /^(\s*[-*+] \[)([ xX])(\] )(.*)$/.exec(line);
      if (task) tasks.push({ at: at + task[1].length, done: task[2] !== " ", text: task[4] });
    }
    at += line.length + 1;
  }
  const description = start < 0 ? lines.join("\n") : [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return { tasks, description: description.trim() };
}

async function save(issue: Issue, body: string) {
  try {
    const next = parseIssue(await saveIssue(issue, body));
    if (next) {
      host.changed(next);
      if (shown?.file === next.file) show(next, true);
    }
  } catch (error) {
    showError(error);
  }
}
function change(issue: Issue, key: string, value: string | string[]) {
  try {
    return save(issue, setField(issue.body, key, value));
  } catch (error) {
    showError(error);
  }
}

// chip is a property shown as a word that opens its menu.
function chip(name: string, label: string, content: Node[], entries: () => MenuEntry[], className = "") {
  const button = el("button", "issue-chip " + className);
  button.type = "button";
  button.dataset.menu = name;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);
  button.append(...content, el("span", "issue-chip-caret", "▾"));
  const open = () => {
    menuChip = name;
    showMenu(name, entries());
  };
  button.onclick = open;
  button.onkeydown = (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    open();
  };
  return button;
}
function marker(project: string) {
  const span = el("span", "issues-project-marker");
  span.style.background = host.colourOf(project);
  return span;
}
function chips(issue: Issue) {
  const row = el("div", "issue-chips");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Properties");
  const has = (label: string) => issue.labels.some((l) => l.toLowerCase() === label.toLowerCase());
  const toggle = (label: string) => change(issue, "labels", has(label) ? issue.labels.filter((l) => l.toLowerCase() !== label.toLowerCase()) : [...issue.labels, label]);
  row.append(
    chip("issue-status", `State: ${statusName(issue.status)}. Change`, [el("span", "", statusName(issue.status))],
      () => statuses.map(([id, name]): MenuEntry => [name, "", () => change(issue, "status", id), undefined, issue.status === id ? "radio:on" : "radio:off"]),
      "issue-state state-" + issue.status),
    chip("issue-priority", `Priority: ${priorityName(issue.priority)}. Change`, [el("span", "", issue.priority === "none" ? "No priority" : priorityName(issue.priority))],
      () => priorities.map(([id, name]): MenuEntry => [name, "", () => change(issue, "priority", id), undefined, issue.priority === id ? "radio:on" : "radio:off"]),
      "issue-priority-word priority-" + issue.priority),
    chip("issue-labels", `Labels: ${issue.labels.join(", ") || "none"}. Change`,
      issue.labels.length ? issue.labels.map((label) => el("span", "issue-tag", "#" + label)) : [el("span", "issue-none", "Add labels")],
      () => [
        ...host.labels().map((label): MenuEntry => [label, "", () => toggle(label), undefined, has(label) ? "check:on" : "check:off"]),
        "-",
        ["New label…", "", () => inputDialog("New label", "Label", "", (name) => {
          const label = name.replace(/[,\[\]]/g, "").trim();
          if (label && !has(label)) return change(issue, "labels", [...issue.labels, label]);
        }), undefined, "plus"],
      ]),
    chip("issue-project", `Project: ${issue.project || "none"}. Change`,
      issue.project ? [marker(issue.project), el("span", "", issue.project)] : [el("span", "issue-none", "No project")],
      () => [
        ["No project", "", () => change(issue, "project", ""), undefined, issue.project ? "radio:off" : "radio:on"],
        ...host.projects().map((project): MenuEntry => [project, "", () => change(issue, "project", project), undefined, issue.project === project ? "radio:on" : "radio:off"]),
        "-",
        ["New project…", "", () => inputDialog("New project", "Project", "", (name) => {
          const project = name.replace(/[,\[\]]/g, "").trim();
          if (project) return change(issue, "project", project);
        }), undefined, "plus"],
      ]),
    el("span", "issue-created", "Created " + longDate(issue.created)),
  );
  return row;
}
function longDate(date: string, time = false) {
  const parsed = new Date(date.length === 10 ? date + "T12:00:00" : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, time ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" });
}

// The title renames in place: Enter keeps it, Escape leaves it.
function title(issue: Issue) {
  const heading = el("h1", "issue-page-title");
  const button = el("button", "issue-title-button", issue.title);
  button.type = "button";
  button.title = "Rename issue";
  button.onclick = () => {
    const input = el("input", "issue-title-input");
    input.value = issue.title;
    input.setAttribute("aria-label", "Issue title");
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (keep && value && value !== issue.title) change(issue, "title", value);
      else heading.replaceChildren(button);
      if (!keep) button.focus();
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    };
    input.onblur = () => finish(true);
    heading.replaceChildren(input);
    input.select();
  };
  heading.append(button);
  return heading;
}

function tasksSection(issue: Issue, tasks: Task[]) {
  const section = el("section", "issue-section");
  const heading = el("h2", "", "Done when");
  heading.id = "issue-done-when";
  const list = el("ul", "issue-tasks");
  list.setAttribute("aria-labelledby", heading.id);
  for (const task of tasks) {
    const item = el("li");
    const label = el("label", "issue-task");
    const box = el("input");
    box.type = "checkbox";
    box.checked = task.done;
    box.onchange = () => save(issue, issue.body.slice(0, task.at) + (box.checked ? "x" : " ") + issue.body.slice(task.at + 1));
    label.append(box, el("span", "", task.text));
    item.append(label);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

// Links in the issue, and notes linking to it, open in Notes.
async function linksSection(issue: Issue, current: number) {
  const section = el("section", "issue-section");
  const list = el("ul", "issue-links");
  section.append(el("h2", "", "Linked notes"), list);
  const targets = [...new Set([...issue.body.matchAll(/\[\[([^\]|#^]+)/g)].map((match) => match[1].trim()))];
  const found = await Promise.all(targets.map((target) =>
    api<{ id: string; found: boolean }>("/api/resolve", "POST", { id: issue.file, body: target }).then((r) => (r.found ? r.id : "")).catch(() => "")));
  if (current !== generation) return section;
  const items: [string, string][] = [
    ...found.filter(Boolean).map((id): [string, string] => [id, "Links to"]),
    ...issue.backlinks.filter((id) => !found.includes(id)).map((id): [string, string] => [id, "Linked from"]),
  ];
  for (const [id, relation] of items) {
    const item = el("li");
    const link = el("button", "issue-link");
    link.type = "button";
    link.innerHTML = icon("noteLink");
    link.append(el("span", "issue-link-name", id), el("span", "issue-link-relation", relation));
    link.onclick = () => host.openNote(id);
    item.append(link);
    list.append(item);
  }
  if (!items.length) list.append(el("li", "issue-none", "No linked notes."));
  return section;
}

function show(issue: Issue, keepFocus = false) {
  // After a choice the menu has closed and taken focus with it; the chip
  // that opened it gets focus back.
  const active = document.activeElement as HTMLElement | null;
  const lost = !active || active === document.body || Boolean(active.closest("#menu-popup"));
  const focusedMenu = keepFocus ? active?.dataset.menu || (lost ? menuChip : undefined) : undefined;
  if (keepFocus) menuChip = "";
  shown = issue;
  const current = ++generation;
  const article = el("article", "issue-page");
  article.setAttribute("aria-label", `Issue ${issue.key}`);
  const bar = el("div", "issue-page-bar");
  const path = el("span", "issue-page-path");
  if (issue.project) path.append(marker(issue.project), el("span", "", issue.project), el("span", "issue-page-sep", "/"));
  path.append(el("span", "issue-key", issue.key));
  const open = el("button", "issue-page-action");
  open.type = "button";
  open.innerHTML = icon("noteLink");
  open.append("Open in Notes");
  open.onclick = () => host.openNote(issue.file);
  const close = el("button", "icon-button");
  close.type = "button";
  close.setAttribute("aria-label", "Close issue");
  close.title = "Close issue · Escape";
  close.innerHTML = icon("close");
  close.onclick = () => closeIssuePage(true);
  bar.append(path, el("span", "issues-spacer"), open, close);
  const { tasks, description } = doneWhen(issue.body);
  const text = el("div", "issue-description preview-content");
  if (!description) {
    text.textContent = "No description yet. Open in Notes to write one.";
    text.classList.add("issue-none");
  }
  // Note links in the text open in Notes.
  text.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const url = link && new URL(link.href, location.href);
    const id = url && url.origin === location.origin ? url.searchParams.get("note") : null;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    host.openNote(id);
  });
  article.append(bar, title(issue), chips(issue), text);
  if (tasks.length) article.append(tasksSection(issue, tasks));
  const footer = el("footer", "issue-page-footer");
  footer.append(el("span", "", `Stored as ${issue.file}.md`), el("span", "", "Edited " + longDate(issue.modified, true)));
  page().replaceChildren(article);
  article.after(footer);
  if (focusedMenu) page().querySelector<HTMLElement>(`[data-menu="${focusedMenu}"]`)?.focus();
  if (description)
    api<{ html: string }>("/api/render", "POST", { id: issue.file, body: description })
      .then(({ html }) => { if (current === generation) text.innerHTML = html; })
      .catch(() => { text.textContent = description; });
  linksSection(issue, current).then((section) => { if (current === generation) article.append(section); }).catch(() => {});
}
function closeIssuePage(returnFocus = false) {
  if (!shown) return;
  const file = shown.file;
  shown = null;
  generation++;
  if (returnFocus) host.closed(file);
}
function shownIssue() {
  return shown;
}
// refreshIssuePage shows the newest text of the open issue after a reload.
function refreshIssuePage(issues: Issue[]) {
  if (!shown) return;
  const next = issues.find((issue) => issue.file === shown?.file);
  if (!next) closeIssuePage();
  else if (next.revision !== shown.revision) show(next, true);
}
function setupIssuePage(pageHost: PageHost) {
  host = pageHost;
  page().addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !shown || !$("menu-popup").hidden || (event.target as Element).closest("input, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    closeIssuePage(true);
  });
}

export { closeIssuePage, refreshIssuePage, setupIssuePage, show as showIssuePage, shownIssue };
