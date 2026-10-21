// Issues are Markdown notes in the vault's issues/ folder, one file per issue,
// named by its ID (issues/SPC-3.md). Flat front matter holds the properties;
// the text below it is the description. issues/Issues.md holds the vault's
// ID prefix, projects and labels. Editing one property rewrites only its
// value, so the rest of the file stays as the user wrote it.
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
  file: string; // the note ID, such as issues/SPC-3
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
}
interface IssueSettings { prefix: string; projects: string[]; labels: string[]; file?: IssueFile }

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
  const key = file.id.slice(folder.length + 1);
  const match = keyPattern.exec(key);
  if (!file.id.startsWith(folder + "/") || !match) return null;
  const { front, values } = fields(file.body);
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
    project: values.get("project") || "",
    created: values.get("created") || file.modified.slice(0, 10),
    description: (front ? front.rest : file.body).trim(),
    body: file.body,
    revision: file.revision,
    modified: file.modified,
    backlinks: file.backlinks || [],
  };
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

interface NewIssue { title: string; status: Status; priority: Priority; labels: string[]; project: string; description: string }
function issueBody(issue: NewIssue) {
  const rows = [
    `title: ${JSON.stringify(issue.title)}`,
    `status: ${issue.status}`,
    `priority: ${issue.priority}`,
    `labels: ${yamlValue(issue.labels)}`,
    ...(issue.project ? [`project: ${yamlValue(issue.project)}`] : []),
    `created: ${today()}`,
  ];
  const text = issue.description.trim();
  return `---\n${rows.join("\n")}\n---\n${text ? "\n" + text + "\n" : ""}`;
}
function settingsBody(prefix: string) {
  return `---\nprefix: ${prefix}\nprojects: []\nlabels: []\n---\n\nSettings for Issues in this vault: the ID prefix of new issues, and the projects and labels offered when creating one. Each issue is a note in this folder, named by its ID.\n`;
}

async function loadIssues() {
  const data = await api<{ files: IssueFile[] }>("/api/plugin-files?plugin=issues");
  const issues = data.files.map(parseIssue).filter((issue): issue is Issue => issue !== null);
  return { issues, settings: parseSettings(data.files.find((file) => file.id === settingsFile)) };
}
// nextKey numbers on from the highest issue with the prefix.
function nextKey(prefix: string, issues: Issue[]) {
  const highest = Math.max(0, ...issues.filter((issue) => issue.key.startsWith(prefix + "-")).map((issue) => issue.number));
  return `${prefix}-${highest + 1}`;
}
// createIssue saves the issue under the next free ID; when another window
// took that ID meanwhile, it counts on.
async function createIssue(prefix: string, issues: Issue[], issue: NewIssue) {
  let key = nextKey(prefix, issues);
  for (let attempt = 0; ; attempt++) {
    try {
      await api("/api/note", "POST", { id: `${folder}/${key}`, body: issueBody(issue) });
      return key;
    } catch (error) {
      if (attempt >= 20 || !/already exists/i.test(error instanceof Error ? error.message : "")) throw error;
      key = `${prefix}-${Number(key.slice(prefix.length + 1)) + 1}`;
    }
  }
}
async function createSettings(prefix: string) {
  await api("/api/note", "POST", { id: settingsFile, body: settingsBody(prefix) });
}
// saveIssue writes a changed body, refusing to replace edits made elsewhere.
async function saveIssue(issue: Issue, body: string) {
  return api<IssueFile>("/api/note", "PUT", { id: issue.file, body, revision: issue.revision });
}
async function updateSettings(settings: IssueSettings, key: "projects" | "labels", values: string[]) {
  if (!settings.file) return;
  await api("/api/note", "PUT", { id: settings.file.id, body: setField(settings.file.body, key, values), revision: settings.file.revision });
}

export type { Issue, IssueFile, IssueSettings, NewIssue, Priority, Status };
export {
  createIssue,
  createSettings,
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
