// Front matter: the YAML (---) or TOML (+++) block opening a note. Write
// shows it as editable properties above the text and keeps its bytes as
// they were until the properties themselves change.
export interface FrontMatter {
  prefix: string;
  bom: string;
  fence: string;
  inner: string;
  gap: string;
  rest: string;
}

const pattern = /^(﻿?)(---|\+\+\+)\n(?:([\s\S]*?)\n)?\2[ \t]*(?:\n|$)(\n*)/;

// splitFrontMatter separates a closed front matter block from the text after
// it, or returns null when the note has none.
function splitFrontMatter(body: string): FrontMatter | null {
  const match = pattern.exec(body);
  if (!match) return null;
  const [prefix, bom, fence, inner = "", gap] = match;
  return { prefix, bom, fence, inner, gap, rest: body.slice(prefix.length) };
}

// withProperties rebuilds a note from edited properties and its text, in
// the form its front matter already had.
function withProperties(front: FrontMatter | null | undefined, inner: string, rest: string) {
  if (front) {
    const start = front.bom.length + front.fence.length + 1;
    const tail = front.prefix.slice(start + front.inner.length);
    return front.prefix.slice(0, start) + inner + (inner && !tail.startsWith("\n") ? "\n" : "") + tail + rest;
  }
  const fence = "---";
  const block = inner === "" ? `${fence}\n${fence}\n` : `${fence}\n${inner.replace(/\n+$/, "")}\n${fence}\n`;
  return block + "\n" + rest;
}

export { splitFrontMatter, withProperties };
