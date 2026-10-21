// Issues, a plugin for keeping a project's map. Each project is a folder in
// the vault's issues/ folder with its own ID prefix (see issues-data.ts). A
// tree of projects sits beside the page: a project reads as an outline of
// its issues in Now, Next and Later, each carrying its "Done when" steps as
// facets; "All projects" lists what has attention everywhere; an issue opens
// as its own page. A board shows the same issues as cards in state columns.
import { $, showError, showToast, state, storage } from "./core.js";
import { icon } from "./icons.js";
import { openModal } from "./dialogs.js";
import { registerPlugin, type PluginCommand, type SpaceContext } from "./plugins.js";
import { closeIssuePage, doneWhen, refreshIssuePage, setupIssuePage, showIssuePage, shownIssue } from "./issues-page.js";
import { showMenu, type MenuEntry } from "./menus.js";
import {
  checkProjectName,
  createIssue,
  createProject,
  loadIssues,
  moveIssue,
  nextKey,
  parseIssue,
  priorities,
  priorityName,
  saveIssue,
  setField,
  statusName,
  statuses,
  suggestPrefix,
  updateSettings,
  validPrefix,
  type Issue,
  type IssueSettings,
  type Priority,
  type Project,
  type Status,
} from "./issues-data.js";

let issues: Issue[] = [];
let projectList: Project[] = [];
let settings: IssueSettings = { prefix: "", projects: [], labels: [] };
let context: SpaceContext | null = null;
let query = "";
// What the page shows without an open issue: one project, or all of them.
const allProjects = "";
const viewKey = () => "labradorite-issues-view:" + state.vaultId;
let view = allProjects;
// The page shows as an outline, or as a board of state columns.
const boardKey = "labradorite-issues-board";
let board = storage.get(boardKey) !== "false";
const root = () => $("issues-app");
const searchBox = () => $("issues-search") as HTMLInputElement;
const finished = (issue: Issue) => issue.status === "done" || issue.status === "cancelled";
const doneFolder = "\u0000done";
const looseFolder = "\u0000loose";
const inbox = "Inbox";
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
// Projects are the project folders, plus projects that flat issues name.
const projects = () => [...new Set([...projectList.map((p) => p.name), ...issues.filter((i) => !i.flat).map((i) => i.project)])].sort((a, b) => a.localeCompare(b));
const projectOf = (name: string) => projectList.find((p) => p.name === name);
const labels = () => {
  const seen = new Map<string, string>();
  for (const label of [...settings.labels, ...issues.flatMap((issue) => issue.labels)]) if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};
const matches = (issue: Issue) => !query || issue.title.toLowerCase().includes(query.toLowerCase()) || issue.key.toLowerCase().includes(query.toLowerCase());
const inView = (issue: Issue) => view === allProjects || (!issue.flat && issue.project === view);
const steps = (issue: Issue) => doneWhen(issue.body).tasks;
function linkedNotes(issue: Issue) {
  const targets = new Set([...issue.body.matchAll(/\[\[([^\]|#^]+)/g)].map((m) => m[1].trim()));
  return [...targets, ...issue.backlinks.filter((id) => !targets.has(id))];
}

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
// A project's row opens its outline; on the open project it folds instead.
function folderRow(folder: string, name: string, count: number, open: boolean) {
  const row = element("button", "folder-group");
  row.type = "button";
  row.dataset.folder = folder;
  row.setAttribute("aria-expanded", String(open));
  const isProject = !folder.startsWith("\u0000");
  const current = isProject && view === folder && !shownIssue();
  row.classList.toggle("current", current);
  if (current) row.setAttribute("aria-current", "page");
  row.innerHTML = icon("chevronDown");
  const sign = folder === doneFolder ? element("span", "issue-done-mark") : folder === looseFolder ? element("span", "issue-done-mark") : marker(folder);
  if (folder === doneFolder) sign.innerHTML = icon("check");
  if (folder === looseFolder) sign.innerHTML = icon("note");
  row.append(sign, element("span", "", name), element("small", "", String(count)));
  row.onclick = () => {
    if (isProject && !current) {
      if (!open) setFolded(folder, false);
      showProject(folder);
    } else {
      setFolded(folder, open);
      renderTree();
    }
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
  for (const project of projects()) {
    const inside = open.filter((issue) => !issue.flat && issue.project === project).sort(byAttention);
    if (!inside.length && (query || !projectOf(project))) continue;
    nodes.push(folderRow(project, project, inside.length, !fold.has(project)));
    if (!fold.has(project)) nodes.push(...inside.map(treeRow));
  }
  const loose = open.filter((issue) => issue.flat).sort(byAttention);
  if (loose.length) {
    nodes.push(folderRow(looseFolder, "Not in a folder", loose.length, !fold.has(looseFolder)));
    if (!fold.has(looseFolder)) nodes.push(...loose.map(treeRow));
  }
  const done = shown.filter(finished).sort((a, b) => b.modified.localeCompare(a.modified));
  if (done.length) {
    nodes.push(folderRow(doneFolder, "Done", done.length, !fold.has(doneFolder)));
    if (!fold.has(doneFolder)) nodes.push(...done.map(treeRow));
  }
  if (!nodes.length) nodes.push(element("p", "list-empty", issues.length ? "No issues match." : "No projects yet."));
  tree.replaceChildren(...nodes);
  $("issues-count").textContent = String(projects().length);
  $("issues-overview").setAttribute("aria-pressed", String(view === allProjects && !shownIssue()));
  if (hadFocus !== null) (tree.querySelector<HTMLElement>(`[data-issue="${CSS.escape(hadFocus)}"]`) || tree.querySelector<HTMLElement>("button"))?.focus();
}

// Facets show an issue's "Done when" steps: one per step, lit when done.
function facets(issue: Issue) {
  const all = steps(issue);
  const wrap = element("span", "issue-facets");
  if (!all.length) return wrap;
  const done = all.filter((step) => step.done).length;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${done} of ${all.length} steps done`);
  for (const step of all.slice(0, 8)) wrap.append(element("span", "issue-facet" + (step.done ? " done" : "")));
  if (all.length > 8) wrap.append(element("small", "issue-facet-more", `+${all.length - 8}`));
  wrap.append(element("small", "", `${done} of ${all.length}`));
  return wrap;
}
function meta(issue: Issue, withProject: boolean) {
  const line = element("span", "issue-line-meta");
  line.append(element("span", "", issue.key));
  if (withProject && issue.project) line.append(element("span", "", issue.project));
  if (issue.priority !== "none") line.append(element("span", "issue-priority-word priority-" + issue.priority, priorityName(issue.priority)));
  for (const label of issue.labels) line.append(element("span", "issue-tag", "#" + label));
  return line;
}
function outlineRow(issue: Issue, withProject: boolean) {
  const row = element("button", "issue-line");
  row.type = "button";
  row.dataset.issue = issue.file;
  const text = element("span", "issue-line-text");
  text.append(element("span", "issue-line-title", issue.title), meta(issue, withProject));
  const notes = linkedNotes(issue);
  const links = element("span", "issue-line-links");
  if (notes.length) {
    links.append(element("span", "issue-line-link", (notes[0].split("/").pop() || notes[0])));
    if (notes.length > 1) links.append(element("span", "issue-line-more", `+${notes.length - 1}`));
  }
  row.append(text, facets(issue), links);
  row.onclick = () => openIssue(issue);
  return row;
}
// The ring around a project is its "Done when" steps, as one cut facet each.
function stepRing(done: number, total: number) {
  const ring = element("div", "issues-ring");
  ring.setAttribute("role", "img");
  ring.setAttribute("aria-label", total ? `${done} of ${total} steps done` : "No steps yet");
  const share = total ? done / total : 0;
  ring.innerHTML = `<svg viewBox="0 0 112 112" aria-hidden="true"><polygon class="issues-ring-base" points="56,6 99,31 99,81 56,106 13,81 13,31" pathLength="100"/><polygon class="issues-ring-lit" points="56,6 99,31 99,81 56,106 13,81 13,31" pathLength="100" stroke-dasharray="${(share * 100).toFixed(1)} 100"/></svg>`;
  const label = element("span", "issues-ring-label");
  label.append(element("strong", "", total ? `${Math.round(share * 100)}%` : "—"), element("small", "", "steps done"));
  ring.append(label);
  return ring;
}
function section(status: Status, name: string, inState: Issue[], withProject: boolean) {
  const folds = status === "done" || status === "cancelled";
  const block = element(folds ? "details" : "section", "issues-doc-section state-" + status);
  const heading = element(folds ? "summary" : "h2", "issues-doc-heading");
  heading.append(element("span", "", name), element("span", "issues-doc-count", String(inState.length)));
  const list = element("div", "issues-doc-list");
  list.append(...inState.map((issue) => outlineRow(issue, withProject)));
  if (!inState.length) list.append(element("p", "issues-doc-empty", status === "in-progress" ? "Nothing has attention now." : "Nothing lined up next."));
  block.append(heading, list);
  return block;
}
function pageActions() {
  const actions = element("div", "issues-page-actions");
  const toggle = element("button", "issue-page-action", board ? "Outline" : "Board");
  toggle.type = "button";
  toggle.onclick = () => setBoard(!board);
  const add = element("button", "primary-button", "New issue");
  add.type = "button";
  add.onclick = () => newIssue();
  actions.append(toggle, add);
  return actions;
}
function renderIntro() {
  const intro = element("div", "issues-intro");
  const button = element("button", "primary-button", "New issue");
  button.type = "button";
  button.onclick = () => newIssue();
  intro.append(element("h1", "", "Map your projects"), element("p", "", "Each project is a folder of Markdown notes with its own ID prefix. Start a project with its first issue."), button);
  $("issues-page").replaceChildren(intro);
}
// The header of a project, or of all projects: its steps ring, name and
// facts, and the page's actions; issues not yet in a folder are offered
// a move.
function projectHeader(shown: Issue[]) {
  const nodes: HTMLElement[] = [];
  const project = view === allProjects ? null : projectOf(view);
  const top = element("header", "issues-doc-top");
  if (project) top.style.setProperty("--project", colourOf(project.name));
  const all = shown.flatMap(steps);
  top.append(stepRing(all.filter((step) => step.done).length, all.length));
  const titles = element("div", "issues-doc-titles");
  titles.append(element("h1", "", view === allProjects ? "All projects" : view));
  const open = shown.filter((issue) => !finished(issue));
  const facts = [`${open.length} open ${open.length === 1 ? "issue" : "issues"}`, `${all.filter((s) => s.done).length} of ${all.length} Done-when steps`];
  if (project) facts.push(`prefix ${project.prefix || "not set"}`, `issues/${project.name}/`);
  else facts.push(`${projects().length} ${projects().length === 1 ? "project" : "projects"}`);
  titles.append(element("p", "issues-doc-facts", facts.join(" · ")));
  top.append(titles, pageActions());
  nodes.push(top);
  const loose = issues.filter((issue) => issue.flat);
  if (view === allProjects && loose.length) {
    const note = element("div", "issues-banner");
    const move = element("button", "issue-page-action", "Move into project folders");
    move.type = "button";
    move.onclick = () => organise();
    note.append(element("span", "", `${loose.length} ${loose.length === 1 ? "issue is" : "issues are"} not in a project folder yet. Each moves into the folder of its project, keeping its ID.`), move);
    nodes.push(note);
  }
  return nodes;
}
function renderOutline() {
  const page = $("issues-page");
  const doc = element("div", "issues-doc");
  const shown = issues.filter((issue) => matches(issue) && inView(issue));
  doc.append(...projectHeader(shown));
  for (const [status, name] of statuses) {
    const inState = shown.filter((issue) => issue.status === status).sort(byAttention);
    if (!inState.length && status !== "in-progress" && status !== "todo") continue;
    doc.append(section(status, name, inState, view === allProjects));
  }
  page.replaceChildren(doc);
}

// The board shows the same issues as cards in Now, Next, Later and Done.
// A card moves by dragging it, by its "Move to…" button, or by M.
const columns: Status[] = ["in-progress", "todo", "backlog", "done"];
async function setStatus(issue: Issue, status: Status) {
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
    [statusName(status), "", () => setStatus(issue, status), undefined, issue.status === status ? "radio:on" : "radio:off"]));
}
// A card is lit in its project's colour, with a cut facet in its corner;
// Now cards glow and Done cards step back.
function card(issue: Issue) {
  const item = element("div", "issue-card state-" + issue.status);
  item.style.setProperty("--project", issue.project ? colourOf(issue.project) : "var(--accent)");
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
  const top = element("span", "issue-card-top");
  top.append(marker(issue.project), element("span", "issue-card-key", view === allProjects && issue.project ? `${issue.project} · ${issue.key}` : issue.key));
  if (issue.priority !== "none") top.append(element("span", "issue-badge priority-" + issue.priority, priorityName(issue.priority)));
  open.append(top, element("span", "issue-card-title", issue.title));
  if (steps(issue).length) open.append(facets(issue));
  const foot = element("span", "issue-card-foot");
  for (const label of issue.labels) {
    const pill = element("span", "issue-pill");
    const dot = element("span", "issue-pill-dot");
    dot.style.background = colourOf(label);
    pill.append(dot, label);
    foot.append(pill);
  }
  const notes = linkedNotes(issue).length;
  if (notes) {
    const linked = element("span", "issue-card-links");
    linked.innerHTML = icon("noteLink");
    linked.append(String(notes));
    linked.title = `${notes} linked ${notes === 1 ? "note" : "notes"}`;
    foot.append(linked);
  }
  if (foot.children.length) open.append(foot);
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
  const shown = issues.filter((issue) => matches(issue) && inView(issue));
  const page = element("div", "issues-board-page");
  const head = element("div", "issues-board-head");
  head.append(...projectHeader(shown));
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
      if (issue) setStatus(issue, status);
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
  page.append(head, wrap);
  $("issues-page").replaceChildren(page);
}
function setBoard(on: boolean) {
  board = on;
  storage.set(boardKey, String(on));
  $("issues-board-toggle").setAttribute("aria-pressed", String(on));
  closeIssuePage();
  render();
}
function showProject(name: string) {
  view = name;
  storage.set(viewKey(), name);
  closeIssuePage();
  render();
}
function render() {
  renderTree();
  if (shownIssue()) return;
  if (!issues.length && !projectList.length) renderIntro();
  else if (board) renderBoard();
  else renderOutline();
}

function openIssue(issue: Issue) {
  showIssuePage(issue);
  renderTree();
  $("issues-page").querySelector<HTMLElement>(".issue-chip")?.focus();
}
async function reload() {
  const data = await loadIssues();
  issues = data.issues;
  projectList = data.projects;
  settings = data.settings;
  if (view !== allProjects && !projects().includes(view)) view = allProjects;
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
// projectFields asks for a project's name and prefix; the prefix follows
// the name until the user edits it.
function projectFields(defaultName: string) {
  const name = element("input");
  name.id = "issue-project-name";
  name.autocomplete = "off";
  name.maxLength = 60;
  name.value = defaultName;
  const prefix = element("input");
  prefix.id = "issue-project-prefix";
  prefix.autocomplete = "off";
  prefix.maxLength = 10;
  prefix.value = suggestPrefix(defaultName);
  let edited = false;
  name.oninput = () => { if (!edited) prefix.value = suggestPrefix(name.value); };
  prefix.oninput = () => {
    edited = true;
    prefix.value = prefix.value.toUpperCase();
  };
  const row = element("div", "issue-form-row");
  row.append(field("Project name", name), field("ID prefix", prefix));
  const check = async () => {
    const problem = checkProjectName(name.value.trim());
    if (problem) throw new Error(problem);
    if (projects().some((p) => p.toLowerCase() === name.value.trim().toLowerCase())) throw new Error("A project with that name already exists.");
    if (!validPrefix(prefix.value.trim())) throw new Error("Use 1 to 10 letters or digits for the prefix, starting with a letter.");
    await createProject(name.value.trim(), prefix.value.trim());
    return name.value.trim();
  };
  return { row, name, check };
}
function newProject(then: (name: string) => void) {
  const container = element("div", "issue-form");
  const fields = projectFields("");
  container.append(fields.row, element("p", "dialog-description", "The project becomes a folder in issues/, and its issue IDs start with the prefix."));
  openModal("New project", container, async () => {
    const name = await fields.check();
    await reload();
    setTimeout(() => then(name), 0);
  }, { submit: "Create project" });
}
// ensureProject gives a project named by a flat issue its folder and prefix.
async function ensureProject(name: string) {
  if (projectOf(name)) return;
  await createProject(name, suggestPrefix(name));
  projectList.push({ name, prefix: suggestPrefix(name), file: { id: `issues/${name}/Project`, title: "Project", body: "", revision: "", modified: "", backlinks: [] } });
}
async function moveTo(issue: Issue, project: string) {
  try {
    // The page shows the moved issue again once the folder has been read.
    const wasShown = shownIssue()?.file === issue.file;
    await ensureProject(project);
    const moved = await moveIssue(issue, project);
    await reload();
    const next = issues.find((item) => item.file === moved?.file);
    if (next && wasShown) openIssue(next);
    showToast(`${issue.key} moved to ${project}`);
  } catch (error) {
    showError(error);
  }
}
// organise moves issues saved directly in issues/ into their projects' folders.
async function organise() {
  const loose = issues.filter((issue) => issue.flat);
  try {
    for (const issue of loose) {
      const project = checkProjectName(issue.project) ? inbox : issue.project;
      await ensureProject(project);
      await moveIssue(issue, project);
    }
    await reload();
    showToast(`Moved ${loose.length} ${loose.length === 1 ? "issue" : "issues"} into project folders`);
  } catch (error) {
    showError(error);
    reload().catch(() => {});
  }
}

// newIssue reads the folder again first, so the ID it offers is current.
function newIssue(status: Status = "todo") {
  reload().then(() => issueDialog(status)).catch(showError);
}
function issueDialog(status: Status) {
  const container = element("div", "issue-form");
  const title = element("input");
  title.id = "issue-title-input";
  title.autocomplete = "off";
  title.required = true;
  title.maxLength = 200;
  const stateSelect = select("issue-status-input", statuses.map(([id, name]) => [id, name]), status);
  const prioritySelect = select("issue-priority-input", priorities.map(([id, name]) => [id, name]), "none");
  const newValue = "\u0000new";
  const names = projectList.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const chosen = shownIssue()?.project || (view !== allProjects ? view : "");
  const projectSelect = select("issue-project-input", [...names.map((name): [string, string] => [name, name]), [newValue, "New project…"]],
    names.includes(chosen) ? chosen : names[0] || newValue);
  const fresh = projectFields(names.length ? "" : inbox);
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
  row3.append(field("Project", projectSelect), field("Labels", labelInput));
  const next = element("p", "dialog-description");
  const explain = () => {
    const project = projectOf(projectSelect.value);
    fresh.row.hidden = projectSelect.value !== newValue;
    next.textContent = project
      ? `This issue becomes ${nextKey(project.prefix, issues)} in issues/${project.name}/.`
      : "The new project becomes a folder in issues/, and its issue IDs start with the prefix.";
  };
  projectSelect.onchange = explain;
  explain();
  container.append(field("Title", title), row2, row3, fresh.row, field("Description", description), next, suggestions("issue-label-options", labels()));
  openModal("New issue", container, async () => {
    const name = title.value.trim();
    if (!name) throw new Error("Give the issue a title.");
    const projectName = projectSelect.value === newValue ? await fresh.check() : projectSelect.value;
    await reload();
    const project = projectOf(projectName);
    if (!project?.prefix) throw new Error(`Give ${projectName} an ID prefix in issues/${projectName}/Project.md.`);
    const tags = [...new Set(labelInput.value.split(",").map((label) => label.replace(/[\[\],]/g, "").trim()).filter(Boolean))];
    const key = await createIssue(project, issues, {
      title: name,
      status: stateSelect.value as Status,
      priority: prioritySelect.value as Priority,
      labels: tags,
      description: description.value,
    });
    // New labels are offered next time.
    const newLabels = tags.filter((label) => !settings.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
    if (newLabels.length && settings.file) await updateSettings(settings, "labels", [...settings.labels, ...newLabels]);
    view = project.name;
    storage.set(viewKey(), view);
    await reload();
    const created = issues.find((issue) => issue.file === `issues/${project.name}/${key}`);
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
        <button type="button" class="icon-button" id="issues-overview" aria-label="All projects" title="All projects" aria-pressed="false"><span data-icon="list">${icon("list")}</span></button>
        <button type="button" class="icon-button" id="issues-board-toggle" aria-label="Show as a board" title="Show as a board" aria-pressed="${board}"><span data-icon="columns">${icon("columns")}</span></button>
      </div>
      <div class="issues-search-field" id="issues-search-field" hidden>
        <input type="search" id="issues-search" placeholder="Find by title or ID" aria-label="Find issues by title or ID" autocomplete="off">
      </div>
      <div class="list-heading"><span class="list-title"><span>Projects</span> <span id="issues-count" class="issues-count">0</span></span></div>
      <nav class="note-list issues-tree" id="issues-tree" aria-label="Projects and their issues"></nav>
    </aside>
    <main class="issues-page" id="issues-page" aria-label="Issues"></main>`;
  $("issues-new").onclick = () => newIssue();
  $("issues-search-button").onclick = () => toggleSearch();
  $("issues-overview").onclick = () => showProject(allProjects);
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
        if ((item.getAttribute("aria-expanded") === "true") !== open) {
          setFolded(item.dataset.folder || "", !open);
          renderTree();
          $("issues-tree").querySelector<HTMLElement>(`.folder-group[data-folder="${CSS.escape(item.dataset.folder || "")}"]`)?.focus();
        }
      } else if (!open) target = items.slice(0, at).reverse().find((el) => el.classList.contains("folder-group"));
    } else return;
    event.preventDefault();
    target?.focus();
  });
  setupIssuePage({
    projects,
    labels,
    colourOf,
    moveTo,
    newProject,
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
    { label: "New project", run: () => newProject((name) => showProject(name)) },
    { label: "Find issues", run: findIssues },
    { label: "Show all projects", run: () => showProject(allProjects) },
    { label: "Show issues as a board", run: () => setBoard(true) },
    { label: "Show issues as an outline", run: () => setBoard(false) },
    { label: "Show or hide the issue projects", run: toggleSidebar },
  ];
  registerPlugin({
    contract: 1,
    id: "issues",
    name: "Issues",
    description: "Map your projects as Markdown notes",
    icon: "issues",
    image: "/assets/plugin-issues.png",
    colour: "--plugin-issues",
    folder: "issues",
    fileTypes: [".md"],
    railItems: () => rail,
    commands: () => commands,
    mount(ctx) {
      context = ctx;
      view = storage.get(viewKey()) || allProjects;
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
      const target = $("issues-tree").querySelector<HTMLElement>(".note-row.selected, .folder-group.current") || $("issues-tree").querySelector<HTMLElement>("button") || $("issues-new");
      target.focus();
    },
    shortcutHelp: () => [
      ["Alt N", "New issue"],
      ["↑ ↓ ← →", "Move between projects, issues and cards"],
      ["M", "Move the focused card to another state"],
      ["Enter", "Open the focused issue"],
      ["Escape", "Close the issue page"],
    ],
    shortcut(chord) {
      if (chord !== "alt+n") return false;
      newIssue();
      return true;
    },
  });
}

export { registerIssuesPlugin };
