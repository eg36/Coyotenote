import type { CompletionContext } from "@codemirror/autocomplete";
import type { Note, SourceEditor } from "./types.js";

interface SourceOptions {
  onChange(body: string): void;
  onFind(): void;
  getNotes(): Note[];
  onWarning(message: string): void;
  onFiles(files: File[]): void;
  imageFiles(transfer: DataTransfer | null): File[];
}

import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
  placeholder,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
} from "@codemirror/language";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { search, findNext, findPrevious, replaceNext, replaceAll, getSearchQuery, closeSearchPanel, searchKeymap, highlightSelectionMatches, openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";
import { tags } from "@lezer/highlight";

export function createSource(
  element: HTMLElement,
  { onChange, onFind, getNotes, onWarning, onFiles, imageFiles }: SourceOptions,
): SourceEditor {
  let updating = false;
  const readOnly = new Compartment();
  const colors = HighlightStyle.define([
    { tag: tags.heading, color: "var(--accent)", fontWeight: "650" },
    { tag: tags.heading2, color: "var(--pink)" },
    { tag: tags.heading3, color: "var(--blue)" },
    { tag: tags.strong, fontWeight: "700", color: "var(--warn)" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: [tags.link, tags.url], color: "var(--cyan)" },
    { tag: tags.monospace, color: "var(--good)" },
    { tag: [tags.quote, tags.meta], color: "var(--muted)" },
    { tag: tags.processingInstruction, color: "var(--pink)" },
  ]);
  const completion = (context: CompletionContext) => {
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (!match) return null;
    return {
      from: match.from + 2,
      options: getNotes().map((n) => ({
        label: n.id,
        type: "text",
        apply: n.id + "]]",
      })),
      validFor: /[^\]\n]*/,
    };
  };
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    highlightSpecialChars(),
    history(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    search(),
    markdown(),
    syntaxHighlighting(colors),
    placeholder("A thought, a list, the beginning of something…"),
    EditorView.lineWrapping,
    // Pasted or dropped images are saved in the vault and linked here.
    EditorView.domEventHandlers({
      paste(event) {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        onFiles(files);
        return true;
      },
      drop(event, view) {
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (at !== null) view.dispatch({ selection: { anchor: at } });
        onFiles(files);
        return true;
      },
    }),
    autocompletion({ override: [completion] }),
    keymap.of([
      ...completionKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Mod-f", run: () => { onFind(); return true; } },
      ...searchKeymap,
      indentWithTab,
    ]),
    readOnly.of(EditorState.readOnly.of(false)),
    EditorView.contentAttributes.of({
      "aria-label": "Markdown editor",
      spellcheck: "false",
    }),
    EditorState.transactionFilter.of((tr) => {
      if (updating || !tr.docChanged) return tr;
      if (
        tr.newDoc.lines > 10000 ||
        new TextEncoder().encode(tr.newDoc.toString()).length > 4 * 1024 * 1024
      ) {
        onWarning("Edit rejected: notes support up to 10,000 lines and 4 MiB.");
        return [];
      }
      return tr;
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !updating) onChange(update.state.doc.toString());
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        background: "var(--surface)",
        color: "var(--text)",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--source-font-size, 16px)",
        lineHeight: "1.85",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "24px 24px 80px 10px",
        caretColor: "var(--accent)",
      },
      ".cm-line": { padding: "0 6px" },
      ".cm-gutters": {
        background: "var(--surface)",
        color: "var(--muted)",
        border: "none",
        minWidth: "44px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 10px 0 8px",
        opacity: ".55",
      },
      ".cm-activeLineGutter": {
        background: "transparent",
        color: "var(--accent)",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor": { borderLeftColor: "var(--accent)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        background: "color-mix(in srgb, var(--accent) 25%, transparent)",
      },
      ".cm-tooltip": {
        background: "var(--chrome)",
        color: "var(--text)",
        border: "1px solid var(--line)",
        borderRadius: "8px",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        background: "var(--accent)",
        color: "var(--onPill)",
      },
      ".cm-panels": { background: "var(--chrome)", color: "var(--text)" },
      ".cm-searchMatch": {
        background: "color-mix(in srgb,var(--warn) 30%,transparent)",
      },
    }),
  ];
  const view = new EditorView({
    parent: element,
    state: EditorState.create({ doc: "", extensions }),
  });
  return {
    view,
    replace(body, { reset = false } = {}) {
      if (!reset && view.state.doc.toString() === body) return;
      updating = true;
      if (reset) {
        view.setState(EditorState.create({ doc: body, extensions }));
      } else {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: body },
        });
      }
      updating = false;
    },
    focus() {
      view.focus();
    },
    find(query) {
      openSearchPanel(view);
      // Start from the words already typed in the notes search, if any.
      // The panel exists only once opened, so the query follows it.
      if (query) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
    },
    search(query, replacement, options) {
      closeSearchPanel(view);
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, replace: replacement, literal: true, ...options })) });
    },
    matchCount() {
      const query = getSearchQuery(view.state);
      if (!query.search) return 0;
      if (!query.valid) return -1;
      const cursor = query.getCursor(view.state);
      let count = 0;
      while (!cursor.next().done) count++;
      return count;
    },
    nextMatch(previous = false) { (previous ? findPrevious : findNext)(view); },
    replaceMatch(all = false) { (all ? replaceAll : replaceNext)(view); },
    readOnly(value) {
      view.dispatch({
        effects: readOnly.reconfigure(EditorState.readOnly.of(value)),
      });
    },
    insert(text) {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    wrap(before, after = before) {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: before + (selected || "text") + after },
        selection: {
          anchor: from + before.length,
          head: from + before.length + (selected || "text").length,
        },
      });
      view.focus();
    },
    refresh() {
      view.requestMeasure();
    },
    // topLine passes the first visible line's number to then. It reads the
    // layout in CodeMirror's own measure cycle: forcing a measure while keys
    // arrive could put typed characters out of order.
    topLine(then) {
      view.requestMeasure({
        key: "coyote-top-line",
        read: (v) => v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop).from).number,
        write: then,
      });
    },
    onScroll(listener) {
      view.scrollDOM.addEventListener("scroll", listener, { passive: true });
    },
    goToLine(number) {
      const line = view.state.doc.line(
        Math.max(1, Math.min(number, view.state.doc.lines)),
      );
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
      });
      view.focus();
    },
  };
}
