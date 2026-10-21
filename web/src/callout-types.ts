// Callout types, kept apart from the Write extension so the Format panel can
// list them without loading the editor.
// Every type and alias, with the type it looks like and its icon, as in
// the preview (cmd/labradorite/syntax.go). Unknown types look like a note.
export const types: [string, string, string][] = [
  ["note", "pen", ""], ["abstract", "list", "summary tldr"], ["info", "info", ""],
  ["todo", "checkSquare", ""], ["tip", "flame", "hint important"],
  ["success", "check", "check done"], ["question", "help", "help faq"],
  ["warning", "alert", "caution attention"], ["failure", "close", "fail missing"],
  ["danger", "zap", "error"], ["bug", "bug", ""], ["example", "ordered", ""], ["quote", "quote", "cite"],
];
// The types offered when making a callout, in the order the preview lists them.
export const calloutTypes = types.map(([name]) => name);
