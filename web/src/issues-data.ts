// Issues are Markdown notes in the vault's issues/ folder. Each project is a
// folder there, issues/<Project>/, whose Project.md holds the project's ID
// prefix; its issues are named by their ID (issues/Space/LS-3.md). Flat
// front matter holds the properties; the text below it is the description.
// issues/Issues.md offers labels. Issues saved directly in issues/ before
// projects had folders keep working until they are moved into one. Editing
// one property rewrites only its value, so the rest of the file stays as
// the user wrote it.
import { api } from "./api.js";
import { splitFrontMatter, withProperties } from "./frontmatter.js";
import { parseProperties } from "./properties.js";

type Status = "backlog" | "todo" | "in-progress" | "done" | "cancelled";
type Priority = "none" | "low" | "medium" | "high" | "urgent";
// States in the order Issues shows them, with the words it shows: what has
// attention now, what comes next, what waits until later. The files keep
// the plain status values.
const statuses: [Status, string][] = [
  ["in-progress", "Now"],
  ["todo", "Next"],
  ["backlog", "Later"],
  ["done", "Done"],
  ["cancelled", "Dropped"],
];
const priorities: [Priority, string][] = [
  ["urgent", "Urgent"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["none", "No priority"],
];
const statusName = (status: Status) => statuses.find(([id]) => id === status)?.[1] || "Later";
const priorityName = (priority: Priority) => priorities.find(([id]) => id === priority)?.[1] || "No priority";

interface IssueFile { id: string; title: string; body: string; revision: string; modified: string; backlinks: string[] }
interface Issue {
  file: string; // the note ID, such as issues/Space/LS-3
  key: string; // SPC-3
  number: number;
  title: string;
  status: Status;
  priority: Priority;
  labels: string[];
  project: string;
  created: string;
  description: string;
  body: string;
  revision: string;
  modified: string;
  backlinks: string[];
  flat: boolean; // saved directly in issues/, not yet in a project folder
}
interface IssueSettings { prefix: string; projects: string[]; labels: string[]; file?: IssueFile }
interface Project { name: string; prefix: string; file: IssueFile }

const folder = "issues";
const settingsFile = folder + "/Issues";
// An issue's file name is its ID: a prefix of letters and digits, a dash and
// a number. Other files in the folder are left alone.
const keyPattern = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,7})$/;
const validPrefix = (prefix: string) => /^[A-Z][A-Z0-9]{0,9}$/.test(prefix);

function fields(body: string) {
  const front = splitFrontMatter(body);
  const rows = front ? parseProperties(front.inner) || [] : [];
  const values = new Map(rows.map((row) => [row.key.toLowerCase(), row.value]));
  return { front, values };
}
const list = (value = "") => value.split(",").map((part) => part.trim()).filter(Boolean);

function parseIssue(file: IssueFile): Issue | null {
  const parts = file.id.split("/");
  if (parts[0] !== folder || parts.length < 2 || parts.length > 3) return null;
  const key = parts.at(-1) || "";
  const match = keyPattern.exec(key);
  if (!match) return null;
  const { front, values } = fields(file.body);
  // A project folder names the project; a flat issue keeps its property.
  const flat = parts.length === 2;
  const status = (values.get("status") || "").toLowerCase().replace(/\s+/g, "-") as Status;
  const priority = (values.get("priority") || "").toLowerCase() as Priority;
  return {
    file: file.id,
    key,
    number: Number(match[2]),
    title: values.get("title") || key,
    status: statuses.some(([id]) => id === status) ? status : "backlog",
    priority: priorities.some(([id]) => id === priority) ? priority : "none",
    labels: list(values.get("labels")),
    project: flat ? values.get("project") || "" : parts[1],
    created: values.get("created") || file.modified.slice(0, 10),
    description: (front ? front.rest : file.body).trim(),
    body: file.body,
    revision: file.revision,
    modified: file.modified,
    backlinks: file.backlinks || [],
    flat,
  };
}
function parseProject(file: IssueFile): Project | null {
  const parts = file.id.split("/");
  if (parts.length !== 3 || parts[0] !== folder || parts[2] !== "Project") return null;
  const prefix = (fields(file.body).values.get("prefix") || "").toUpperCase();
  return { name: parts[1], prefix: validPrefix(prefix) ? prefix : "", file };
}

function parseSettings(file: IssueFile | undefined): IssueSettings {
  const { values } = fields(file?.body || "");
  const prefix = (values.get("prefix") || "").toUpperCase();
  return { prefix: validPrefix(prefix) ? prefix : "", projects: list(values.get("projects")), labels: list(values.get("labels")), file };
}

// yamlValue writes a value the small front matter reader reads back as is.
function yamlValue(value: string | string[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => yamlValue(item)).join(", ")}]`;
  if (/^[\p{L}\p{N}_][\p{L}\p{N}_ .\/@-]*$/u.test(value) && !/^(?:null|~|yes|no|on|off|true|false)$/i.test(value) && value.trim() === value)
    return value;
  return JSON.stringify(value);
}

// setField changes one front matter property, adding it when missing, and
// leaves every other byte of the note alone.
function setField(body: string, key: string, value: string | string[]): string {
  const front = splitFrontMatter(body);
  const line = `${key}: ${yamlValue(value)}`;
  if (!front) return withProperties(null, line, body);
  const rows = parseProperties(front.inner);
  // Properties in a form the reader does not know are edited in Notes, never
  // guessed at here.
  if (!rows) throw new Error("This issue's properties use a form Issues cannot change. Edit them in Notes.");
  const row = rows.find((r) => r.key.toLowerCase() === key.toLowerCase());
  if (row) {
    const inner = front.inner.slice(0, row.start) + yamlValue(value) + front.inner.slice(row.end);
    return withProperties(front, inner, front.rest);
  }
  const inner = front.inner ? `${front.inner.replace(/\n+$/, "")}\n${line}` : line;
  return withProperties(front, inner, front.rest);
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface NewIssue { title: string; status: Status; priority: Priority; labels: string[]; description: string }
// An issue in a project folder takes its project from the folder, so the
// file does not repeat it.
function issueBody(issue: NewIssue) {
  const rows = [
    `title: ${JSON.stringify(issue.title)}`,
    `status: ${issue.status}`,
    `priority: ${issue.priority}`,
    `labels: ${yamlValue(issue.labels)}`,
    `created: ${today()}`,
  ];
  const text = issue.description.trim();
  return `---\n${rows.join("\n")}\n---\n${text ? "\n" + text + "\n" : ""}`;
}
function projectBody(name: string, prefix: string) {
  return `---\nprefix: ${prefix}\n---\n\nThe ${name} project. Its issues are the notes in this folder, named by their ID; new ones start with ${prefix}.\n`;
}
// A suggested prefix: the initials of a name of several words, else its
// first letters.
function suggestPrefix(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join("") : words[0] || "";
  const prefix = letters.replace(/^[^A-Za-z]+/, "").slice(0, words.length > 1 ? 4 : 3).toUpperCase();
  return prefix.length > 1 ? prefix : (prefix + (words[0] || "ISS").replace(/[^A-Za-z]/g, "")).slice(0, 3).toUpperCase() || "ISS";
}
// A project's folder name must also be a valid note folder.
function checkProjectName(name: string) {
  if (!name) return "Name the project.";
  if (/[\/\\<>:"|?*#^\[\],]/.test(name) || name.startsWith(".") || name !== name.trim()) return "Use letters, digits, spaces and dashes in a project name.";
  return "";
}

async function loadIssues() {
  const data = await api<{ files: IssueFile[] }>("/api/plugin-files?plugin=issues");
  const issues = data.files.map(parseIssue).filter((issue): issue is Issue => issue !== null);
  const projects = data.files.map(parseProject).filter((project): project is Project => project !== null);
  return { issues, projects, settings: parseSettings(data.files.find((file) => file.id === settingsFile)) };
}
// nextKey numbers on from the highest issue with the prefix.
function nextKey(prefix: string, issues: Issue[]) {
  const highest = Math.max(0, ...issues.filter((issue) => issue.key.startsWith(prefix + "-")).map((issue) => issue.number));
  return `${prefix}-${highest + 1}`;
}
// createIssue saves the issue under the next free ID; when another window
// took that ID meanwhile, it counts on.
async function createIssue(project: Project, issues: Issue[], issue: NewIssue) {
  const prefix = project.prefix;
  let key = nextKey(prefix, issues);
  for (let attempt = 0; ; attempt++) {
    try {
      await api("/api/note", "POST", { id: `${folder}/${project.name}/${key}`, body: issueBody(issue) });
      return key;
    } catch (error) {
      if (attempt >= 20 || !/already exists/i.test(error instanceof Error ? error.message : "")) throw error;
      key = `${prefix}-${Number(key.slice(prefix.length + 1)) + 1}`;
    }
  }
}
async function createProject(name: string, prefix: string) {
  await api("/api/note", "POST", { id: `${folder}/${name}/Project`, body: projectBody(name, prefix) });
}
// moveIssue puts an issue in another project's folder, keeping its ID; the
// server rewrites links to it. A project property left in the file follows.
async function moveIssue(issue: Issue, project: string) {
  const target = `${folder}/${project}/${issue.key}`;
  if (target === issue.file) return issue;
  const moved = await api<{ note: IssueFile }>("/api/rename", "POST", { id: issue.file, revision: issue.revision, name: target });
  const next = parseIssue(moved.note);
  if (!next || !fields(next.body).values.has("project")) return next;
  return parseIssue(await saveIssue(next, setField(next.body, "project", project)));
}
// saveIssue writes a changed body, refusing to replace edits made elsewhere.
async function saveIssue(issue: Issue, body: string) {
  return api<IssueFile>("/api/note", "PUT", { id: issue.file, body, revision: issue.revision });
}
async function updateSettings(settings: IssueSettings, key: "projects" | "labels", values: string[]) {
  if (!settings.file) return;
  await api("/api/note", "PUT", { id: settings.file.id, body: setField(settings.file.body, key, values), revision: settings.file.revision });
}

export type { Issue, IssueFile, IssueSettings, NewIssue, Priority, Project, Status };
export {
  checkProjectName,
  createIssue,
  createProject,
  moveIssue,
  suggestPrefix,
  folder,
  loadIssues,
  nextKey,
  parseIssue,
  priorities,
  priorityName,
  saveIssue,
  setField,
  settingsFile,
  statusName,
  statuses,
  updateSettings,
  validPrefix,
  yamlValue,
};
