// Issues, a plugin for tracking work, laid out as an issue notebook: a tree
// of projects beside the open issue's page. Without an open issue, the page
// reads as a document of what is on Now, Next and Later. Issues are notes in
// the vault's issues/ folder (see issues-data.ts).
import { $, showError, showToast, state, storage } from "./core.js";
import { icon } from "./icons.js";
import { openModal } from "./dialogs.js";
import { registerPlugin, type PluginCommand, type SpaceContext } from "./plugins.js";
import { closeIssuePage, refreshIssuePage, setupIssuePage, showIssuePage, shownIssue } from "./issues-page.js";
import { showMenu, type MenuEntry } from "./menus.js";
import {
  createIssue,
  createSettings,
  loadIssues,
  parseIssue,
  saveIssue,
  setField,
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

let issues: Issue[] = [];
let settings: IssueSettings = { prefix: "", projects: [], labels: [] };
let context: SpaceContext | null = null;
let query = "";
// The overview shows as a page, or as a board of state columns.
const boardKey = "labradorite-issues-board";
let board = storage.get(boardKey) === "true";
const root = () => $("issues-app");
const searchBox = () => $("issues-search") as HTMLInputElement;
const finished = (issue: Issue) => issue.status === "done" || issue.status === "cancelled";
const doneFolder = "\u0000done";
const noProject = "";
const order = (status: Status) => statuses.findIndex(([id]) => id === status);
const rank = (priority: Priority) => priorities.findIndex(([id]) => id === priority);
const byAttention = (a: Issue, b: Issue) => order(a.status) - order(b.status) || rank(a.priority) - rank(b.priority) || b.number - a.number;

// Theme colour names for projects and labels: a name always gets the same one.
const palette = ["blue", "pink", "cyan", "good", "warn", "danger"];
function colourOf(name: string) {
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
function marker(project: string) {
  const span = element("span", "issues-project-marker");
  span.style.background = project ? colourOf(project) : "var(--line-strong)";
  return span;
}
const projects = () => [...new Set([...settings.projects, ...issues.map((issue) => issue.project).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
const labels = () => {
  const seen = new Map<string, string>();
  for (const label of [...settings.labels, ...issues.flatMap((issue) => issue.labels)]) if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};
const matches = (issue: Issue) => !query || issue.title.toLowerCase().includes(query.toLowerCase()) || issue.key.toLowerCase().includes(query.toLowerCase());

// Folded tree folders are remembered per vault; Done starts folded.
const foldKey = () => "labradorite-issues-folded:" + state.vaultId;
function folded() {
  try {
    const saved = JSON.parse(storage.get(foldKey()) || "null");
    return new Set<string>(Array.isArray(saved) ? saved : [doneFolder]);
  } catch {
    return new Set([doneFolder]);
  }
}
function setFolded(folder: string, fold: boolean) {
  const set = folded();
  if (fold) set.add(folder);
  else set.delete(folder);
  storage.set(foldKey(), JSON.stringify([...set]));
}

function treeRow(issue: Issue) {
  const row = element("button", "note-row issue-tree-row");
  row.type = "button";
  row.dataset.issue = issue.file;
  row.title = issue.title;
  const current = shownIssue()?.file === issue.file;
  row.classList.toggle("selected", current);
  row.setAttribute("aria-current", current ? "page" : "false");
  const head = element("span", "note-row-head");
  head.append(element("span", "issue-state state-" + issue.status, statusName(issue.status)), element("span", "note-title", issue.title), element("span", "note-date", issue.key));
  row.append(head);
  row.onclick = () => openIssue(issue);
  return row;
}
function folderRow(folder: string, name: string, count: number, open: boolean) {
  const row = element("button", "folder-group");
  row.type = "button";
  row.dataset.folder = folder;
  row.setAttribute("aria-expanded", String(open));
  row.innerHTML = icon("chevronDown");
  row.append(folder === doneFolder ? element("span", "issue-done-mark", "✓") : marker(folder), element("span", "", name), element("small", "", String(count)));
  row.onclick = () => {
    setFolded(folder, open);
    renderTree();
    $("issues-tree").querySelector<HTMLElement>(`.folder-group[data-folder="${CSS.escape(folder)}"]`)?.focus();
  };
  return row;
}
function renderTree() {
  const tree = $("issues-tree");
  const hadFocus = tree.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.issue || "" : null;
  const fold = query ? new Set<string>() : folded();
  const shown = issues.filter(matches);
  const nodes: HTMLElement[] = [];
  const open = shown.filter((issue) => !finished(issue));
  for (const project of [...projects(), noProject]) {
    const inside = open.filter((issue) => issue.project === project).sort(byAttention);
    if (!inside.length) continue;
    nodes.push(folderRow(project, project || "No project", inside.length, !fold.has(project)));
    if (!fold.has(project)) nodes.push(...inside.map(treeRow));
  }
  const done = shown.filter(finished).sort((a, b) => b.modified.localeCompare(a.modified));
  if (done.length) {
    nodes.push(folderRow(doneFolder, "Done", done.length, !fold.has(doneFolder)));
    if (!fold.has(doneFolder)) nodes.push(...done.map(treeRow));
  }
  if (!nodes.length) nodes.push(element("p", "list-empty", issues.length ? "No issues match." : "No issues yet."));
  tree.replaceChildren(...nodes);
  $("issues-count").textContent = String(open.length);
  if (hadFocus !== null) (tree.querySelector<HTMLElement>(`[data-issue="${CSS.escape(hadFocus)}"]`) || tree.querySelector<HTMLElement>("button"))?.focus();
}

// The document lists what has attention: Now, Next and Later, with Done
// and Dropped folded at the end.
function issueLine(issue: Issue) {
  const line = element("button", "issue-line");
  line.type = "button";
  line.dataset.issue = issue.file;
  const meta = element("span", "issue-line-meta");
  meta.append(element("span", "", issue.key));
  if (issue.project) meta.append(element("span", "", issue.project));
  if (issue.priority !== "none") meta.append(element("span", "issue-priority-word priority-" + issue.priority, priorityName(issue.priority)));
  for (const label of issue.labels) meta.append(element("span", "issue-tag", "#" + label));
  line.append(element("span", "issue-line-title", issue.title), meta);
  line.onclick = () => openIssue(issue);
  return line;
}
function renderDocument() {
  if (shownIssue()) return;
  const page = $("issues-page");
  if (!issues.length) {
    const intro = element("div", "issues-intro");
    const button = element("button", "primary-button", "New issue");
    button.type = "button";
    button.onclick = () => newIssue();
    intro.append(element("h1", "", "Track your work"), element("p", "", "Each issue is a Markdown note in the issues folder, with its state, priority, labels and project at the top. Start with the first one."), button);
    page.replaceChildren(intro);
    return;
  }
  const doc = element("div", "issues-doc");
  const shown = issues.filter(matches);
  for (const [status, name] of statuses) {
    const inState = shown.filter((issue) => issue.status === status).sort(byAttention);
    if (!inState.length && status !== "in-progress" && status !== "todo") continue;
    const folds = status === "done" || status === "cancelled";
    const section = element(folds ? "details" : "section", "issues-doc-section state-" + status);
    const heading = element(folds ? "summary" : "h2", "issues-doc-heading");
    heading.append(element("span", "", name), element("span", "issues-doc-count", String(inState.length)));
    const list = element("div", "issues-doc-list");
    list.append(...inState.map(issueLine));
    if (!inState.length) list.append(element("p", "issues-doc-empty", status === "in-progress" ? "Nothing has your attention now." : "Nothing is lined up next."));
    section.append(heading, list);
    doc.append(section);
  }
  page.replaceChildren(doc);
}
// The board shows the same issues as cards in Now, Next, Later and Done.
// A card moves by dragging it, by its "Move to…" button, or by M.
const columns: Status[] = ["in-progress", "todo", "backlog", "done"];
async function moveIssue(issue: Issue, status: Status) {
  if (issue.status === status) return;
  try {
    const moved = parseIssue(await saveIssue(issue, setField(issue.body, "status", status)));
    if (!moved) return;
    issues = issues.map((item) => (item.file === moved.file ? moved : item));
    render();
    $("issues-page").querySelector<HTMLElement>(`.issue-card[data-issue="${CSS.escape(moved.file)}"] .issue-card-open`)?.focus();
    showToast(`${moved.key} moved to ${statusName(status)}`);
  } catch (error) {
    showError(error);
  }
}
function moveMenu(issue: Issue) {
  showMenu("issue-move-" + issue.key, columns.map((status): MenuEntry =>
    [statusName(status), "", () => moveIssue(issue, status), undefined, issue.status === status ? "radio:on" : "radio:off"]));
}
function card(issue: Issue) {
  const item = element("div", "issue-card");
  item.dataset.issue = issue.file;
  item.setAttribute("role", "listitem");
  item.draggable = true;
  item.ondragstart = (event) => {
    event.dataTransfer?.setData("application/x-labradorite-issue", issue.file);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    item.classList.add("dragging");
  };
  item.ondragend = () => item.classList.remove("dragging");
  const open = element("button", "issue-card-open");
  open.type = "button";
  const meta = element("span", "issue-line-meta");
  meta.append(element("span", "", issue.key));
  if (issue.project) meta.append(element("span", "", issue.project));
  if (issue.priority !== "none") meta.append(element("span", "issue-priority-word priority-" + issue.priority, priorityName(issue.priority)));
  open.append(element("span", "issue-card-title", issue.title), meta);
  if (issue.labels.length) {
    const tags = element("span", "issue-card-tags");
    tags.append(...issue.labels.map((label) => element("span", "issue-tag", "#" + label)));
    open.append(tags);
  }
  const links = issue.backlinks.length + new Set([...issue.body.matchAll(/\[\[([^\]|#^]+)/g)].map((m) => m[1])).size;
  if (links) {
    const linked = element("span", "issue-card-links");
    linked.innerHTML = icon("noteLink");
    linked.append(`${links} linked ${links === 1 ? "note" : "notes"}`);
    open.append(linked);
  }
  open.onclick = () => openIssue(issue);
  open.onkeydown = (event) => {
    if (event.key.toLowerCase() !== "m" || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    moveMenu(issue);
  };
  const move = element("button", "issue-card-move");
  move.type = "button";
  move.dataset.menu = "issue-move-" + issue.key;
  move.setAttribute("aria-haspopup", "menu");
  move.setAttribute("aria-expanded", "false");
  move.setAttribute("aria-label", `Move ${issue.key} to…`);
  move.title = "Move to… · M";
  move.textContent = "Move to…";
  move.onclick = () => moveMenu(issue);
  item.append(open, move);
  return item;
}
function renderBoard() {
  if (shownIssue()) return;
  const shown = issues.filter(matches);
  const wrap = element("div", "issues-board");
  for (const status of columns) {
    const inColumn = shown.filter((issue) => issue.status === status).sort(byAttention);
    const column = element("section", "issues-column state-" + status);
    column.dataset.status = status;
    const heading = element("h2", "issues-column-heading");
    heading.id = "issues-column-" + status;
    heading.append(element("span", "", statusName(status)), element("span", "issues-doc-count", String(inColumn.length)));
    const list = element("div", "issues-column-cards");
    list.setAttribute("role", "list");
    list.setAttribute("aria-labelledby", heading.id);
    list.append(...inColumn.map(card));
    column.ondragover = (event) => {
      if (!event.dataTransfer?.types.includes("application/x-labradorite-issue")) return;
      event.preventDefault();
      column.classList.add("drop-target");
    };
    column.ondragleave = (event) => {
      if (!column.contains(event.relatedTarget as Node)) column.classList.remove("drop-target");
    };
    column.ondrop = (event) => {
      event.preventDefault();
      column.classList.remove("drop-target");
      const issue = issues.find((item) => item.file === event.dataTransfer?.getData("application/x-labradorite-issue"));
      if (issue) moveIssue(issue, status);
    };
    column.append(heading, list);
    wrap.append(column);
  }
  // The arrows move between cards: up and down in a column, sideways across.
  wrap.addEventListener("keydown", (event) => {
    const from = (event.target as Element).closest<HTMLElement>(".issue-card");
    if (!from || !(event.target as Element).classList.contains("issue-card-open")) return;
    const cols = [...wrap.querySelectorAll<HTMLElement>(".issues-column-cards")].map((list) => [...list.querySelectorAll<HTMLElement>(".issue-card")]);
    const col = cols.findIndex((cards) => cards.includes(from)), row = cols[col].indexOf(from);
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = cols[col][row + 1];
    else if (event.key === "ArrowUp") target = cols[col][row - 1];
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? 1 : -1;
      for (let c = col + step; c >= 0 && c < cols.length && !target; c += step) target = cols[c][Math.min(row, cols[c].length - 1)];
    } else return;
    event.preventDefault();
    target?.querySelector<HTMLElement>(".issue-card-open")?.focus();
  });
  $("issues-page").replaceChildren(wrap);
}
function setBoard(on: boolean) {
  board = on;
  storage.set(boardKey, String(on));
  $("issues-board-toggle").setAttribute("aria-pressed", String(on));
  closeIssuePage();
  render();
}
function render() {
  renderTree();
  if (board && issues.length) renderBoard();
  else renderDocument();
}

function openIssue(issue: Issue) {
  showIssuePage(issue);
  renderTree();
  $("issues-page").querySelector<HTMLElement>(".issue-chip")?.focus();
}
async function reload() {
  const data = await loadIssues();
  issues = data.issues;
  settings = data.settings;
  refreshIssuePage(issues);
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
  const hint = element("p", "dialog-description");
  const explain = () => { hint.textContent = `Issue IDs start with this prefix, such as ${input.value || "ISS"}-1. Use 1 to 10 letters or digits, starting with a letter.`; };
  input.oninput = () => {
    input.value = input.value.toUpperCase();
    explain();
  };
  explain();
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
  const stateSelect = select("issue-status-input", statuses.map(([id, name]) => [id, name]), status);
  const prioritySelect = select("issue-priority-input", priorities.map(([id, name]) => [id, name]), "none");
  const project = element("input");
  project.id = "issue-project-input";
  project.autocomplete = "off";
  project.setAttribute("list", "issue-project-options");
  project.value = shownIssue()?.project || "";
  const labelInput = element("input");
  labelInput.id = "issue-labels-input";
  labelInput.autocomplete = "off";
  labelInput.placeholder = "Feature, UX";
  labelInput.setAttribute("list", "issue-label-options");
  const description = element("textarea");
  description.id = "issue-description-input";
  description.rows = 4;
  const row2 = element("div", "issue-form-row");
  row2.append(field("State", stateSelect), field("Priority", prioritySelect));
  const row3 = element("div", "issue-form-row");
  row3.append(field("Project", project), field("Labels", labelInput));
  const next = element("p", "dialog-description", `This issue becomes ${nextKey(settings.prefix, issues)}, saved as a Markdown note in the issues folder.`);
  container.append(field("Title", title), row2, row3, field("Description", description), next,
    suggestions("issue-project-options", projects()), suggestions("issue-label-options", labels()));
  openModal("New issue", container, async () => {
    const name = title.value.trim();
    if (!name) throw new Error("Give the issue a title.");
    const chosen = [...new Set(labelInput.value.split(",").map((label) => label.replace(/[\[\]]/g, "").trim()).filter(Boolean))];
    const projectName = project.value.replace(/[,\[\]]/g, "").trim();
    const key = await createIssue(settings.prefix, issues, {
      title: name,
      status: stateSelect.value as Status,
      priority: prioritySelect.value as Priority,
      labels: chosen,
      project: projectName,
      description: description.value,
    });
    // New projects and labels are offered next time.
    if (projectName && !settings.projects.includes(projectName)) {
      await updateSettings(settings, "projects", [...settings.projects, projectName]);
      await reload();
    }
    const newLabels = chosen.filter((label) => !settings.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
    if (newLabels.length) await updateSettings(settings, "labels", [...settings.labels, ...newLabels]);
    await reload();
    const created = issues.find((issue) => issue.file === "issues/" + key);
    showToast(`Created ${key}`);
    // The dialog closes after this returns; then the new issue opens.
    if (created) setTimeout(() => openIssue(created), 0);
  }, { submit: "Create issue" });
}

function setup() {
  root().innerHTML = `
    <aside class="issues-tree-panel" id="issues-sidebar" aria-label="Issues">
      <div class="sidebar-actions" role="toolbar" aria-label="Issues">
        <button type="button" class="icon-button" id="issues-new" aria-label="New issue" title="New issue · Alt N"><span data-icon="plus">${icon("plus")}</span></button>
        <button type="button" class="icon-button" id="issues-search-button" aria-label="Find issues" title="Find issues" aria-expanded="false" aria-controls="issues-search-field"><span data-icon="search">${icon("search")}</span></button>
        <button type="button" class="icon-button" id="issues-overview" aria-label="Now, Next and Later" title="Now, Next and Later"><span data-icon="list">${icon("list")}</span></button>
        <button type="button" class="icon-button" id="issues-board-toggle" aria-label="Show as a board" title="Show as a board" aria-pressed="${board}"><span data-icon="columns">${icon("columns")}</span></button>
      </div>
      <div class="issues-search-field" id="issues-search-field" hidden>
        <input type="search" id="issues-search" placeholder="Find by title or ID" aria-label="Find issues by title or ID" autocomplete="off">
      </div>
      <div class="list-heading"><span class="list-title"><span>Projects</span> <span id="issues-count" class="issues-count">0</span></span></div>
      <nav class="note-list issues-tree" id="issues-tree" aria-label="Issues by project"></nav>
    </aside>
    <main class="issues-page" id="issues-page" aria-label="Issue"></main>`;
  $("issues-new").onclick = () => newIssue();
  $("issues-search-button").onclick = () => toggleSearch();
  $("issues-overview").onclick = () => setBoard(false);
  $("issues-board-toggle").onclick = () => setBoard(!board);
  searchBox().oninput = () => {
    query = searchBox().value.trim();
    render();
  };
  searchBox().onkeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    toggleSearch(false);
  };
  // The arrows move through the tree; Left and Right fold and unfold.
  $("issues-tree").addEventListener("keydown", (event) => {
    const items = [...$("issues-tree").querySelectorAll<HTMLElement>("button")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const item = items[at];
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = items[at + 1];
    else if (event.key === "ArrowUp") target = items[at - 1];
    else if (event.key === "Home") target = items[0];
    else if (event.key === "End") target = items.at(-1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const open = event.key === "ArrowRight";
      if (item.classList.contains("folder-group")) {
        if ((item.getAttribute("aria-expanded") === "true") !== open) item.click();
      } else if (!open) target = items.slice(0, at).reverse().find((el) => el.classList.contains("folder-group"));
    } else return;
    event.preventDefault();
    target?.focus();
  });
  setupIssuePage({
    projects,
    labels,
    colourOf,
    changed(issue) {
      issues = issues.map((item) => (item.file === issue.file ? issue : item));
      renderTree();
    },
    closed(file) {
      render();
      ($("issues-tree").querySelector<HTMLElement>(`[data-issue="${CSS.escape(file)}"]`) || $("issues-new")).focus();
    },
    openNote: (id) => context?.open("notes", id),
  });
}
function toggleSearch(show?: boolean) {
  const box = $("issues-search-field");
  const open = show ?? box.hidden;
  box.hidden = !open;
  $("issues-search-button").setAttribute("aria-expanded", String(open));
  if (open) searchBox().focus();
  else {
    searchBox().value = "";
    query = "";
    render();
    $("issues-search-button").focus();
  }
}

// While Issues shows, files changed outside it show too.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("notes-refreshed", () => {
  if (root().hidden) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reload().catch(() => {}), 50);
});

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
  const hidden = root().classList.toggle("issues-sidebar-hidden");
  $("issues-sidebar-toggle").setAttribute("aria-expanded", String(!hidden));
}
function findIssues() {
  if (root().classList.contains("issues-sidebar-hidden")) toggleSidebar();
  toggleSearch(true);
}

function registerIssuesPlugin() {
  setup();
  const rail = [
    railButton("issues-sidebar-toggle", "issues", "Issues · Show or hide the projects", toggleSidebar),
    railButton("issues-new-rail", "plus", "New issue · Alt N", () => newIssue()),
    railButton("issues-search-rail", "search", "Find issues", findIssues),
  ];
  rail[0].setAttribute("aria-expanded", "true");
  rail[0].setAttribute("aria-controls", "issues-sidebar");
  const commands: PluginCommand[] = [
    { label: "New issue", keys: "Alt N", run: () => newIssue() },
    { label: "Find issues", run: findIssues },
    { label: "Show Now, Next and Later", run: () => setBoard(false) },
    { label: "Show issues as a board", run: () => setBoard(true) },
    { label: "Show or hide the issue projects", run: toggleSidebar },
  ];
  registerPlugin({
    contract: 1,
    id: "issues",
    name: "Issues",
    description: "Track work as Markdown notes",
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
    // A link to an issue file opens its page.
    openLink(target) {
      const open = () => {
        const issue = issues.find((item) => item.file === target);
        if (issue) openIssue(issue);
      };
      if (issues.some((item) => item.file === target)) open();
      else reload().then(open).catch(showError);
      return true;
    },
    focus() {
      const target = $("issues-tree").querySelector<HTMLElement>(".note-row.selected") || $("issues-tree").querySelector<HTMLElement>("button") || $("issues-new");
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
