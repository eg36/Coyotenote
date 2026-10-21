// Issues, a plugin for tracking work. Its list reads the issue notes in the
// vault's issues/ folder (see issues-data.ts), grouped by status, with a
// sidebar of views, projects and labels.
import { $, showError, showToast } from "./core.js";
import { icon } from "./icons.js";
import { openModal } from "./dialogs.js";
import { registerPlugin, type PluginCommand, type SpaceContext } from "./plugins.js";
import {
  createIssue,
  createSettings,
  loadIssues,
  nextKey,
  priorities,
  priorityName,
  statusName,
  statuses,
  updateSettings,
  validPrefix,
  type Issue,
  type IssueSettings,
  type Priority,
  type Status,
} from "./issues-data.js";

type View = "all" | "active" | "backlog" | "done";
const views: [View, string, (issue: Issue) => boolean][] = [
  ["all", "All issues", () => true],
  ["active", "Active", (issue) => issue.status === "todo" || issue.status === "in-progress"],
  ["backlog", "Backlog", (issue) => issue.status === "backlog"],
  ["done", "Done", (issue) => issue.status === "done"],
];
let issues: Issue[] = [];
let settings: IssueSettings = { prefix: "", projects: [], labels: [] };
let context: SpaceContext | null = null;
let focused = "";
const filter = { view: "all" as View, project: "", label: "", query: "", hideDone: true };
const root = () => $("issues-app");
const searchBox = () => $("issues-search") as HTMLInputElement;
const finished = (issue: Issue) => issue.status === "done" || issue.status === "cancelled";

// Theme colour names for labels and projects. Known labels keep their usual
// colour; others get one from their name, so a label keeps it everywhere.
const palette = ["blue", "pink", "cyan", "good", "warn", "danger"];
const known: Record<string, string> = { feature: "blue", ux: "pink", frontend: "cyan", backend: "warn", improvement: "good", accessibility: "good", bug: "danger" };
function colourOf(name: string) {
  const preset = known[name.toLowerCase()];
  if (preset) return `var(--${preset})`;
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--${palette[hash % palette.length]})`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// statusIcon draws a status as a circle: dashed for backlog, outlined for
// todo, half filled in progress, filled with a check when done, crossed when
// cancelled. Its label carries the name, so colour is never the only cue.
function statusIcon(status: Status) {
  const span = element("span", "issue-status status-" + status);
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", "Status: " + statusName(status));
  const shapes: Record<Status, string> = {
    backlog: '<circle cx="8" cy="8" r="6" stroke-dasharray="2.6 2.6"/>',
    todo: '<circle cx="8" cy="8" r="6"/>',
    "in-progress": '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor"/>',
    done: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="m5.2 8.2 1.9 1.9 3.7-3.9" stroke="var(--surface)"/>',
    cancelled: '<circle cx="8" cy="8" r="6"/><path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4"/>',
  };
  span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${shapes[status]}</svg>`;
  return span;
}
// priorityBars shows none to three bars; urgent shows three in the danger colour.
function priorityBars(priority: Priority) {
  const span = element("span", "issue-priority priority-" + priority);
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", "Priority: " + priorityName(priority).toLowerCase());
  const on = { none: 0, low: 1, medium: 2, high: 3, urgent: 3 }[priority];
  span.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    [5, 9, 13].map((height, i) => `<rect x="${1 + i * 6}" y="${14 - height}" width="4" height="${height}" rx="1" class="${i < on ? "on" : "off"}"/>`).join("") + "</svg>";
  return span;
}
function labelChip(name: string) {
  const chip = element("span", "issue-label");
  const dot = element("span", "issue-dot");
  dot.style.background = colourOf(name);
  chip.append(dot, name);
  return chip;
}
function shortDate(date: string) {
  const parsed = new Date(date + (date.length === 10 ? "T12:00:00" : ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function matches(issue: Issue) {
  const view = views.find(([id]) => id === filter.view)!;
  const query = filter.query.toLowerCase();
  return view[2](issue) &&
    (!filter.project || issue.project === filter.project) &&
    (!filter.label || issue.labels.some((label) => label.toLowerCase() === filter.label.toLowerCase())) &&
    (!query || issue.title.toLowerCase().includes(query) || issue.key.toLowerCase().includes(query)) &&
    !(filter.hideDone && filter.view !== "done" && finished(issue));
}
const projects = () => [...new Set([...settings.projects, ...issues.map((issue) => issue.project).filter(Boolean)])].sort();
const labels = () => {
  const seen = new Map<string, string>();
  for (const label of [...settings.labels, ...issues.flatMap((issue) => issue.labels)]) if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

function navRow(label: string, count: number, current: boolean, choose: () => void, marker?: HTMLElement) {
  const row = element("button", "issues-nav-row");
  row.type = "button";
  row.setAttribute("aria-pressed", String(current));
  const name = element("span", "issues-nav-name", label);
  const number = element("span", "issues-nav-count", String(count));
  if (marker) row.append(marker);
  row.append(name, number);
  row.onclick = () => {
    choose();
    render();
  };
  return row;
}
function navSection(title: string, rows: HTMLElement[]) {
  const section = element("section", "issues-nav-section");
  const heading = element("h2", "issues-nav-heading", title);
  heading.id = "issues-nav-" + title.toLowerCase();
  const group = element("div", "issues-nav-rows");
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", heading.id);
  group.append(...rows);
  section.append(heading, group);
  return section;
}
function renderSidebar() {
  const nav = $("issues-nav");
  const sections = [navSection("Views", views.map(([id, name, test]) =>
    navRow(name, issues.filter(test).length, filter.view === id, () => { filter.view = id; })))];
  const projectNames = projects();
  if (projectNames.length)
    sections.push(navSection("Projects", projectNames.map((project) => {
      const marker = element("span", "issues-project-marker");
      marker.style.background = colourOf(project);
      return navRow(project, issues.filter((issue) => issue.project === project && !finished(issue)).length, filter.project === project,
        () => { filter.project = filter.project === project ? "" : project; }, marker);
    })));
  const labelNames = labels();
  if (labelNames.length)
    sections.push(navSection("Labels", labelNames.map((label) => {
      const dot = element("span", "issue-dot");
      dot.style.background = colourOf(label);
      return navRow(label, issues.filter((issue) => issue.labels.some((l) => l.toLowerCase() === label.toLowerCase()) && !finished(issue)).length,
        filter.label.toLowerCase() === label.toLowerCase(), () => { filter.label = filter.label === label ? "" : label; }, dot);
    })));
  nav.replaceChildren(...sections);
}

function chip(text: string, remove: () => void) {
  const item = element("span", "issues-chip", text);
  const button = element("button", "issues-chip-remove");
  button.type = "button";
  button.setAttribute("aria-label", "Remove filter: " + text);
  button.innerHTML = icon("close");
  button.onclick = () => {
    remove();
    render();
    $("issues-search").focus();
  };
  item.append(button);
  return item;
}
function renderFilters(shown: number) {
  const chips: HTMLElement[] = [];
  if (filter.view !== "all") chips.push(chip("View: " + views.find(([id]) => id === filter.view)![1], () => { filter.view = "all"; }));
  if (filter.project) chips.push(chip("Project: " + filter.project, () => { filter.project = ""; }));
  if (filter.label) chips.push(chip("Label: " + filter.label, () => { filter.label = ""; }));
  if (filter.hideDone && filter.view !== "done") chips.push(chip("Status is not Done", () => { filter.hideDone = false; }));
  $("issues-chips").replaceChildren(...chips);
  $("issues-count").textContent = `${shown} ${shown === 1 ? "issue" : "issues"}`;
  $("issues-title").textContent = filter.project || views.find(([id]) => id === filter.view)![1];
  const marker = $("issues-title-marker");
  marker.hidden = !filter.project;
  if (filter.project) marker.style.background = colourOf(filter.project);
}

function row(issue: Issue) {
  const item = element("div", "issue-row");
  item.setAttribute("role", "option");
  item.dataset.issue = issue.file;
  item.tabIndex = issue.file === focused ? 0 : -1;
  item.setAttribute("aria-selected", String(issue.file === focused));
  const key = element("span", "issue-key", issue.key);
  const title = element("span", "issue-title", issue.title);
  const chips = element("span", "issue-labels");
  chips.append(...issue.labels.map(labelChip));
  const date = element("span", "issue-date", shortDate(issue.created));
  item.append(priorityBars(issue.priority), key, statusIcon(issue.status), title, chips, date);
  item.onclick = () => {
    setFocus(issue.file);
    openIssue(issue);
  };
  return item;
}
function renderList() {
  const list = $("issues-list");
  const hadFocus = list.contains(document.activeElement);
  const shown = issues.filter(matches).sort((a, b) =>
    priorities.findIndex(([id]) => id === a.priority) - priorities.findIndex(([id]) => id === b.priority) || b.number - a.number);
  renderFilters(shown.length);
  if (!shown.some((issue) => issue.file === focused)) focused = shown[0]?.file || "";
  const groups: HTMLElement[] = [];
  for (const [status, name] of statuses) {
    const inGroup = shown.filter((issue) => issue.status === status);
    if (!inGroup.length) continue;
    const group = element("div", "issue-group");
    group.setAttribute("role", "group");
    const header = element("div", "issue-group-header");
    header.id = "issue-group-" + status;
    group.setAttribute("aria-labelledby", header.id);
    const add = element("button", "issue-group-add");
    add.type = "button";
    add.setAttribute("aria-label", `New issue in ${name}`);
    add.innerHTML = icon("plus");
    add.onclick = () => newIssue(status);
    header.append(statusIcon(status), element("span", "issue-group-name", name), element("span", "issue-group-count", String(inGroup.length)), add);
    group.append(header, ...inGroup.map(row));
    groups.push(group);
  }
  list.replaceChildren(...groups);
  // A refresh keeps keyboard focus on the same issue.
  if (hadFocus) list.querySelector<HTMLElement>('.issue-row[tabindex="0"]')?.focus();
  const empty = $("issues-empty");
  empty.hidden = shown.length > 0;
  $("issues-empty-text").textContent = issues.length ? "No issues match these filters." : "No issues yet. Each issue is a Markdown file in the issues folder.";
  $("issues-empty-clear").hidden = !issues.length;
}
function render() {
  renderSidebar();
  renderList();
}
function setFocus(file: string, move = false) {
  focused = file;
  for (const item of $("issues-list").querySelectorAll<HTMLElement>(".issue-row")) {
    const current = item.dataset.issue === file;
    item.tabIndex = current ? 0 : -1;
    item.setAttribute("aria-selected", String(current));
    if (current && move) item.focus();
  }
}
// Until the issue panel exists, an issue opens as its note.
function openIssue(issue: Issue) {
  context?.open("notes", issue.file);
}

async function reload() {
  const data = await loadIssues();
  issues = data.issues;
  settings = data.settings;
  render();
}

function field(labelText: string, control: HTMLElement) {
  const wrap = element("div", "issue-field");
  const label = element("label", "field-label", labelText);
  label.htmlFor = control.id;
  wrap.append(label, control);
  return wrap;
}
function select(id: string, options: [string, string][], value: string) {
  const el = element("select");
  el.id = id;
  for (const [key, name] of options) el.add(new Option(name, key));
  el.value = value;
  return el;
}
function suggestions(id: string, values: string[]) {
  const list = element("datalist");
  list.id = id;
  for (const value of values) list.append(new Option(value));
  return list;
}

// prefixDialog asks for the vault's issue ID prefix before the first issue.
function prefixDialog(then: () => void) {
  const container = element("div");
  const input = element("input");
  input.id = "issue-prefix";
  input.autocomplete = "off";
  input.maxLength = 10;
  const vault = ($("brand").title.split("·")[1] || "").trim();
  input.value = (vault.replace(/[^A-Za-z]/g, "").slice(0, 3) || "ISS").toUpperCase();
  input.oninput = () => { input.value = input.value.toUpperCase(); };
  const hint = element("p", "dialog-description", "Issue IDs start with this prefix, such as " + (input.value || "ISS") + "-1. Use 1 to 10 letters or digits, starting with a letter.");
  input.addEventListener("input", () => { hint.textContent = `Issue IDs start with this prefix, such as ${input.value || "ISS"}-1. Use 1 to 10 letters or digits, starting with a letter.`; });
  container.append(field("ID prefix", input), hint);
  openModal("Set up Issues", container, async () => {
    const prefix = input.value.trim().toUpperCase();
    if (!validPrefix(prefix)) throw new Error("Use 1 to 10 letters or digits, starting with a letter.");
    await createSettings(prefix);
    await reload();
    setTimeout(then, 0);
  }, { submit: "Continue" });
  setTimeout(() => input.select(), 50);
}

// newIssue reads the folder again first, so the ID it offers is current.
function newIssue(status: Status = "todo") {
  reload().then(() => issueDialog(status)).catch(showError);
}
function issueDialog(status: Status) {
  if (!settings.prefix) return prefixDialog(() => issueDialog(status));
  const container = element("div", "issue-form");
  const title = element("input");
  title.id = "issue-title-input";
  title.autocomplete = "off";
  title.required = true;
  title.maxLength = 200;
  const statusSelect = select("issue-status-input", statuses.map(([id, name]) => [id, name]), status);
  const prioritySelect = select("issue-priority-input", priorities.map(([id, name]) => [id, name]), "none");
  const project = element("input");
  project.id = "issue-project-input";
  project.autocomplete = "off";
  project.setAttribute("list", "issue-project-options");
  project.value = filter.project;
  const labelInput = element("input");
  labelInput.id = "issue-labels-input";
  labelInput.autocomplete = "off";
  labelInput.placeholder = "Feature, UX";
  labelInput.setAttribute("list", "issue-label-options");
  labelInput.value = filter.label;
  const description = element("textarea");
  description.id = "issue-description-input";
  description.rows = 4;
  const row2 = element("div", "issue-form-row");
  row2.append(field("Status", statusSelect), field("Priority", prioritySelect));
  const row3 = element("div", "issue-form-row");
  row3.append(field("Project", project), field("Labels", labelInput));
  const next = element("p", "dialog-description", `This issue becomes ${nextKey(settings.prefix, issues)}, saved as a Markdown note in the issues folder.`);
  container.append(field("Title", title), row2, row3, field("Description", description), next,
    suggestions("issue-project-options", projects()), suggestions("issue-label-options", labels()));
  openModal("New issue", container, async () => {
    const name = title.value.trim();
    if (!name) throw new Error("Give the issue a title.");
    const chosen = [...new Set(labelInput.value.split(",").map((label) => label.trim()).filter(Boolean))];
    const key = await createIssue(settings.prefix, issues, {
      title: name,
      status: statusSelect.value as Status,
      priority: prioritySelect.value as Priority,
      labels: chosen,
      project: project.value.trim(),
      description: description.value,
    });
    // New projects and labels are offered next time.
    const newProjects = project.value.trim() && !settings.projects.includes(project.value.trim()) ? [...settings.projects, project.value.trim()] : null;
    const newLabels = chosen.filter((label) => !settings.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
    if (newProjects) await updateSettings(settings, "projects", newProjects);
    if (newLabels.length) {
      await reload();
      await updateSettings(settings, "labels", [...settings.labels, ...newLabels]);
    }
    await reload();
    focused = "issues/" + key;
    render();
    showToast(`Created ${key}`);
    // The dialog closes after this returns; then the new issue takes focus.
    setTimeout(() => setFocus(focused, true), 0);
  }, { submit: "Create issue" });
}

function setup() {
  const app = root();
  app.innerHTML = `
    <aside class="issues-sidebar" id="issues-sidebar" aria-label="Issues">
      <div class="issues-sidebar-header"><h1>Issues</h1>
        <button type="button" class="icon-button" id="issues-search-button" aria-label="Search issues" title="Search issues">${icon("search")}</button></div>
      <nav id="issues-nav" aria-label="Issue views"></nav>
    </aside>
    <section class="issues-main" aria-labelledby="issues-title">
      <header class="issues-header">
        <span class="issues-project-marker large" id="issues-title-marker" hidden></span>
        <h2 id="issues-title">All issues</h2>
        <span class="issues-spacer"></span>
        <button type="button" class="primary-button" id="issues-new">${icon("plus")}<span>New issue</span></button>
      </header>
      <div class="issues-filters">
        <div class="issues-chips" id="issues-chips"></div>
        <input type="search" id="issues-search" placeholder="Filter by title or ID" aria-label="Filter issues by title or ID" autocomplete="off">
        <span class="issues-count" id="issues-count" role="status"></span>
      </div>
      <div class="issues-list" id="issues-list" role="listbox" aria-label="Issues"></div>
      <div class="issues-empty" id="issues-empty" hidden>
        <p id="issues-empty-text"></p>
        <button type="button" id="issues-empty-clear">Clear filters</button>
      </div>
    </section>`;
  $("issues-new").onclick = () => newIssue();
  $("issues-search-button").onclick = () => $("issues-search").focus();
  searchBox().oninput = () => {
    filter.query = searchBox().value.trim();
    render();
  };
  $("issues-empty-clear").onclick = () => {
    Object.assign(filter, { view: "all", project: "", label: "", query: "", hideDone: true });
    searchBox().value = "";
    render();
  };
  $("issues-list").addEventListener("keydown", (event) => {
    const rows = [...$("issues-list").querySelectorAll<HTMLElement>(".issue-row")];
    const at = rows.findIndex((item) => item.dataset.issue === focused);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      const target = rows[Math.max(0, Math.min(rows.length - 1, moves[event.key]))];
      if (target) setFocus(target.dataset.issue || "", true);
    } else if (event.key === "Enter") {
      const issue = issues.find((item) => item.file === focused);
      if (issue) {
        event.preventDefault();
        openIssue(issue);
      }
    }
  });
}

function railButton(id: string, iconName: string, label: string, run: () => void) {
  const button = element("button", "icon-button");
  button.id = id;
  button.type = "button";
  button.hidden = true;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<span data-icon="${iconName}">${icon(iconName)}</span>`;
  button.onclick = run;
  document.querySelector(".activity-rail")!.insertBefore(button, document.querySelector(".rail-bottom"));
  return button;
}
function toggleSidebar() {
  const open = root().classList.toggle("issues-sidebar-hidden");
  $("issues-sidebar-toggle").setAttribute("aria-expanded", String(!open));
}
function focusSearch() {
  if (root().classList.contains("issues-sidebar-hidden")) toggleSidebar();
  $("issues-search").focus();
}

// While Issues shows, files changed outside it show too.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("notes-refreshed", () => {
  if (root().hidden) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reload().catch(() => {}), 50);
});

function registerIssuesPlugin() {
  setup();
  const rail = [
    railButton("issues-new-rail", "plus", "New issue · Alt N", () => newIssue()),
    railButton("issues-sidebar-toggle", "sidebar", "Issues sidebar · Show or hide", toggleSidebar),
    railButton("issues-search-rail", "search", "Search issues", focusSearch),
  ];
  rail[1].setAttribute("aria-expanded", "true");
  rail[1].setAttribute("aria-controls", "issues-sidebar");
  const commands: PluginCommand[] = [
    { label: "New issue", keys: "Alt N", run: () => newIssue() },
    { label: "Search issues", run: focusSearch },
    { label: "Show or hide the issues sidebar", run: toggleSidebar },
  ];
  registerPlugin({
    contract: 1,
    id: "issues",
    name: "Issues",
    description: "Track work as Markdown files",
    icon: "issues",
    colour: "--plugin-issues",
    folder: "issues",
    fileTypes: [".md"],
    railItems: () => rail,
    commands: () => commands,
    mount(ctx) {
      context = ctx;
      root().hidden = false;
      reload().catch(showError);
    },
    unmount() {
      root().hidden = true;
    },
    focus() {
      const target = $("issues-list").querySelector<HTMLElement>('.issue-row[tabindex="0"]') || $("issues-new");
      target.focus();
    },
    shortcut(chord) {
      if (chord !== "alt+n") return false;
      newIssue();
      return true;
    },
  });
}

export { registerIssuesPlugin };
