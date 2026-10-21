// Wire shapes mirror cmd/labradorite/server.go. JSON is trusted only at the
// local API boundary; persisted browser data must still be checked on read.
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@codemirror/view";
import type { FrontMatter } from "./frontmatter.js";

export interface Note {
  id: string;
  title: string;
  body?: string;
  excerpt: string;
  revision: string;
  modified: string;
  words: number;
  backlinks: string[];
  tags: string[];
  warning?: string;
  stamps?: [string, string];
}
export interface Theme {
  id: string;
  name: string;
  light: boolean;
  colors: Record<string, string>;
}
export interface Session { token: string; vaultId: string }
export interface StateResponse extends Session {
  notes: Note[];
  matches: string[];
  snippets: Record<string, string>;
  themes: Theme[];
  theme: string;
  vault: string;
  formerVaultIds: string[];
  stamp: string;
  version: string;
  warnings: string[];
  limits: { lines: number; bytes: number };
}
export interface Draft {
  id: string;
  body: string;
  base: string;
  time: number;
  key: string;
}
export interface AppError extends Error { status?: number; current?: Note }
export interface RichEditor {
  set(body: string, id: string): void;
  focus(): void;
  readonly editor: Editor | null;
  spellcheck(value: boolean): void;
  insertImage(src: string, alt: string): void;
  insertWiki(raw: string): void;
  command(name: string, value?: string): void;
  destroy(): void;
}
export interface SourceEditor {
  view: EditorView;
  replace(body: string, options?: { reset?: boolean }): void;
  focus(): void;
  find(query?: string): void;
  search(query: string, replacement: string, options?: { caseSensitive: boolean; wholeWord: boolean; regexp: boolean }): void;
  matchCount(): number;
  nextMatch(previous?: boolean): void;
  replaceMatch(all?: boolean): void;
  readOnly(value: boolean): void;
  insert(text: string): void;
  wrap(before: string, after?: string): void;
  refresh(): void;
  topLine(then: (line: number) => void): void;
  onScroll(listener: EventListener): void;
  goToLine(line: number): void;
}
export interface AppState {
  openGeneration: number;
  filteredIds: Set<string> | null;
  notes: Note[];
  themes: Theme[];
  theme: string;
  current: Note | null;
  body: string;
  savedBody: string;
  mode: "write" | "source" | "preview" | "split";
  token: string;
  vaultId: string;
  dirty: boolean;
  saving: Promise<void> | null;
  savingBody: string | null;
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  previewTimer: ReturnType<typeof setTimeout> | undefined;
  previewGeneration: number;
  rich: RichEditor | null;
  source: SourceEditor | null;
  search: string;
  sort: "modified" | "title-asc" | "title-desc";
  searchGeneration: number;
  trash: { id: string; trashId: string }[];
  pendingDraft: Draft | null;
  block: string;
  edits: number;
  lastError: AppError | null;
  ready: boolean;
  restoring: boolean;
  busy: boolean;
  // Note-changing requests in flight, and how many have finished in total
  // and as of the latest list, so the change watcher can tell this tab's own
  // changes from changes made elsewhere.
  changing: number;
  changes: number;
  listedChanges: number;
  tag: string;
  folder: string | null;
  stamp?: string;
  version?: string;
  snippets?: Record<string, string>;
  searched?: string;
  orphans?: Draft[];
  currentBacklinks?: string[];
  front?: FrontMatter | null;
}
