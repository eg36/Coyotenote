// Front matter: the YAML (---) or TOML (+++) block opening a note. Write
// shows it as editable properties above the text and keeps its bytes as
// they were until the properties themselves change.
const pattern = /^(﻿?)(---|\+\+\+)\n(?:([\s\S]*?)\n)?\2[ \t]*(?:\n|$)(\n*)/;

// splitFrontMatter separates a closed front matter block from the text after
// it, or returns null when the note has none.
function splitFrontMatter(body) {
  const match = pattern.exec(body);
  if (!match) return null;
  const [prefix, bom, fence, inner = "", gap] = match;
  return { prefix, bom, fence, inner, gap, rest: body.slice(prefix.length) };
}

// withProperties rebuilds a note from edited properties and its text, in
// the form its front matter already had.
function withProperties(front, inner, rest) {
  const fence = front?.fence || "---";
  const block = inner === "" ? `${fence}\n${fence}\n` : `${fence}\n${inner.replace(/\n+$/, "")}\n${fence}\n`;
  return (front?.bom || "") + block + (front ? front.gap : "\n") + rest;
}

export { splitFrontMatter, withProperties };
