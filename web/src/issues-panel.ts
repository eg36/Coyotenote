// The issue panel shows one issue beside the Issues list: its properties as
// small menus, its rendered description, its "Done when" tasks and the notes
// it links with. Every change rewrites only the part of the file it touches.
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
  type Priority,
  type Status,
} from "./issues-data.js";

interface PanelHost {
  issues(): Issue[];
  projects(): string[];
  labels(): string[];
  changed(issue: Issue): void; // the issue was saved
  close(): void; // the panel closed; focus returns to the list
  openNote(id: string): void;
  statusIcon(status: Status): HTMLElement;
  priorityBars(priority: Priority): HTMLElement;
  labelChip(name: string): HTMLElement;
  colourOf(name: string): string;
}

let host: PanelHost;
let shown: Issue | null = null;
let renderGeneration = 0;
const panel = () => $("issue-panel");
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

// The "Done when" section is a heading of that name and the task lines
// below it, up to the next heading.
interface Task { line: number; at: number; done: boolean; text: string }
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
      if (task) tasks.push({ line: index, at: at + task[1].length, done: task[2] !== " ", text: task[4] });
    }
    at += line.length + 1;
  }
  const description = start < 0 ? lines.join("\n") : [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return { tasks, description: description.trim() };
}

async function save(issue: Issue, body: string) {
  try {
    const saved = await saveIssue(issue, body);
    const next = parseIssue(saved);
    if (next) {
      host.changed(next);
      if (shown?.file === next.file) show(next);
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

function menuButton(name: string, label: string, content: Node[], entries: () => MenuEntry[]) {
  const button = el("button", "issue-property-value");
  button.type = "button";
  button.dataset.menu = name;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);
  button.append(...content);
  button.onclick = () => showMenu(name, entries());
  button.onkeydown = (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    showMenu(name, entries());
  };
  return button;
}
function property(name: string, value: HTMLElement) {
  const row = el("div", "issue-property");
  const term = el("dt", "", name);
  const data = el("dd");
  data.append(value);
  row.append(term, data);
  return row;
}

function properties(issue: Issue) {
  const list = el("dl", "issue-properties");
  list.append(
    property("Status", menuButton("issue-status", `Status: ${statusName(issue.status)}. Change`,
      [host.statusIcon(issue.status), el("span", "", statusName(issue.status))],
      () => statuses.map(([id, name]): MenuEntry => [name, "", () => change(issue, "status", id), undefined, issue.status === id ? "radio:on" : "radio:off"]))),
    property("Priority", menuButton("issue-priority", `Priority: ${priorityName(issue.priority)}. Change`,
      [host.priorityBars(issue.priority), el("span", "", priorityName(issue.priority))],
      () => priorities.map(([id, name]): MenuEntry => [name, "", () => change(issue, "priority", id), undefined, issue.priority === id ? "radio:on" : "radio:off"]))),
    property("Labels", menuButton("issue-labels", `Labels: ${issue.labels.join(", ") || "none"}. Change`,
      issue.labels.length ? issue.labels.map(host.labelChip) : [el("span", "issue-none", "No labels")],
      () => {
        const has = (label: string) => issue.labels.some((l) => l.toLowerCase() === label.toLowerCase());
        const toggle = (label: string) => change(issue, "labels", has(label) ? issue.labels.filter((l) => l.toLowerCase() !== label.toLowerCase()) : [...issue.labels, label]);
        return [
          ...host.labels().map((label): MenuEntry => [label, "", () => toggle(label), undefined, has(label) ? "check:on" : "check:off"]),
          "-",
          ["New label…", "", () => inputDialog("New label", "Label", "", (name) => {
            const label = name.replace(/[,\[\]]/g, "").trim();
            if (label && !has(label)) return change(issue, "labels", [...issue.labels, label]);
          }), undefined, "plus"],
        ];
      })),
    property("Project", menuButton("issue-project", `Project: ${issue.project || "none"}. Change`,
      issue.project ? [marker(issue.project), el("span", "", issue.project)] : [el("span", "issue-none", "No project")],
      () => [
        ["No project", "", () => change(issue, "project", ""), undefined, issue.project ? "radio:off" : "radio:on"],
        ...host.projects().map((project): MenuEntry => [project, "", () => change(issue, "project", project), undefined, issue.project === project ? "radio:on" : "radio:off"]),
        "-",
        ["New project…", "", () => inputDialog("New project", "Project", "", (name) => {
          const project = name.replace(/[,\[\]]/g, "").trim();
          if (project) return change(issue, "project", project);
        }), undefined, "plus"],
      ])),
    property("Created", el("span", "issue-created", longDate(issue.created))),
  );
  return list;
}
function marker(project: string) {
  const span = el("span", "issues-project-marker");
  span.style.background = host.colourOf(project);
  return span;
}
function longDate(date: string, time = false) {
  const parsed = new Date(date.length === 10 ? date + "T12:00:00" : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, time ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" });
}

function tasksSection(issue: Issue, tasks: Task[]) {
  const section = el("section", "issue-section");
  const heading = el("h3", "", "Done when");
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
async function linksSection(issue: Issue, generation: number) {
  const section = el("section", "issue-section");
  const heading = el("h3", "", "Linked notes");
  const list = el("ul", "issue-links");
  section.append(heading, list);
  const targets = [...new Set([...issue.body.matchAll(/\[\[([^\]|#^]+)/g)].map((match) => match[1].trim()))];
  const found = await Promise.all(targets.map((target) =>
    api<{ id: string; found: boolean }>("/api/resolve", "POST", { id: issue.file, body: target }).then((r) => (r.found ? r.id : "")).catch(() => "")));
  if (generation !== renderGeneration) return section;
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

function show(issue: Issue) {
  shown = issue;
  const generation = ++renderGeneration;
  const box = panel();
  box.hidden = false;
  box.setAttribute("aria-label", `Issue ${issue.key}`);
  const header = el("header", "issue-panel-header");
  const key = el("span", "issue-key", issue.key);
  const open = el("button", "issue-panel-action");
  open.type = "button";
  open.innerHTML = icon("noteLink");
  open.append("Open in Notes");
  open.onclick = () => host.openNote(issue.file);
  const close = el("button", "icon-button");
  close.type = "button";
  close.id = "issue-panel-close";
  close.setAttribute("aria-label", "Close issue");
  close.title = "Close issue · Escape";
  close.innerHTML = icon("close");
  close.onclick = () => hidePanel(true);
  header.append(key, el("span", "issues-spacer"), open, close);
  const body = el("div", "issue-panel-body");
  const title = el("h2", "issue-panel-title", issue.title);
  const { tasks, description } = doneWhen(issue.body);
  const text = el("div", "issue-description preview-content");
  // Note links in the description open in Notes.
  text.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const url = link && new URL(link.href, location.href);
    const id = url && url.origin === location.origin ? url.searchParams.get("note") : null;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    host.openNote(id);
  });
  text.textContent = description ? "" : "No description.";
  if (!description) text.classList.add("issue-none");
  body.append(title, properties(issue), el("h3", "issue-section-heading", "Description"), text);
  if (tasks.length) body.append(tasksSection(issue, tasks));
  const footer = el("footer", "issue-panel-footer");
  footer.append(el("span", "", `Stored as ${issue.file}.md`), el("span", "", "Edited " + longDate(issue.modified, true)));
  box.replaceChildren(header, body, footer);
  document.getElementById("issues-app")?.classList.add("issue-open");
  if (description)
    api<{ html: string }>("/api/render", "POST", { id: issue.file, body: description })
      .then(({ html }) => { if (generation === renderGeneration) text.innerHTML = html; })
      .catch(() => { text.textContent = description; });
  linksSection(issue, generation).then((section) => { if (generation === renderGeneration) body.append(section); }).catch(() => {});
}
function hidePanel(returnFocus = false) {
  if (panel().hidden) return;
  panel().hidden = true;
  shown = null;
  renderGeneration++;
  document.getElementById("issues-app")?.classList.remove("issue-open");
  if (returnFocus) host.close();
}
function shownIssue() {
  return shown;
}
// refreshPanel shows the newest text of the open issue after a reload.
function refreshPanel(issues: Issue[]) {
  if (!shown) return;
  const next = issues.find((issue) => issue.file === shown?.file);
  if (!next) hidePanel();
  else if (next.revision !== shown.revision) show(next);
}
function setupPanel(panelHost: PanelHost) {
  host = panelHost;
  panel().addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || $("menu-popup").hidden === false) return;
    event.preventDefault();
    event.stopPropagation();
    hidePanel(true);
  });
}

export { hidePanel, refreshPanel, setupPanel, show as showIssuePanel, shownIssue };
