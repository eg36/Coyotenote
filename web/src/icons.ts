const paths: Record<string, string> = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  textStyle: '<path d="M4 19 10 4l6 15M6 14h8m3-4h5m-2-3v12"/>',
  vault:
    '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 5V3h8v2m-4 5v5m-3-2h6"/>',
  notebook:
    '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4m-4 5h4m-4 5h4m6-10h4m-4 4h4"/>',
  pin: '<path d="m16 3 5 5-4 2-2 5-2 2-3-3-6 6m3-13 2-2 5-2 2-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shift: '<path d="m12 3 9 9h-5v8H8v-8H3Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  newNote: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="m17.5 3.5 3 3L12 15H9v-3Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  expand: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  replace: '<path d="M4 8h12l-3.5-3.5M16 8l-3.5 3.5M20 16H8l3.5-3.5M8 16l3.5 3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  chevronDown: '<path d="m7 10 5 5 5-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  footnote: '<path d="M3 7h9M7.5 7v12M16 5.5 18 4v6"/>',
  sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
  formulaBlock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15.5 8h-7l3.5 4-3.5 4h7"/>',
  diagram: '<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><path d="M6.5 8v5.5h11V16"/>',
  sidebar:
    '<path class="icon-pane" d="M5 4h4v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="none"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  arrowUp: '<path d="m6 11 6-6 6 6m-6-6v14"/>',
  arrowDown: '<path d="m6 13 6 6 6-6m-6-13v14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  pen: '<path d="m15 4 5 5-11 11-6 1 1-6Z"/><path d="m12 7 5 5"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  columns:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  ordered:
    '<path d="M10 6h11m-11 6h11m-11 6h11M3 4h1v5m-1 4a2 2 0 1 1 2 2l-2 3h3"/>',
  checkSquare:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  quote: '<path d="M4 12h6v7H3v-7c0-5 3-7 7-7m5 7h6v7h-7v-7c0-5 3-7 7-7"/>',
  link: '<path d="m10 14 4-4m-5 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 8a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-2 2" transform="translate(1 0) scale(.9)"/>',
  noteLink: '<path d="M9 4H4v16h12v-5M12 3h9v9m0-9-10 10"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M10 4v16"/>',
  undo: '<path d="M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5" transform="translate(0 -3)"/>',
  redo: '<path d="M21 7H10a6 6 0 0 0 0 12m11-12-5-5m5 5-5 5"/>',
  alert: '<path d="m12 3 10 18H2ZM12 9v5m0 3h.01"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>',
  note: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  flame: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-5 1-8Z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  bug: '<rect x="8" y="7" width="8" height="12" rx="4"/><path d="M12 7V5M9 4l1.5 2M15 4l-1.5 2M8 11H4m16 0h-4M8 15H5m14 0h-3M8.5 18 6 20m9.5-2 2.5 2"/>',
  outline: '<path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3 8 21m8-18-2 18"/>',
  command: '<path d="m4 17 6-5-6-5m8 12h8"/>',
};
export function icon(name: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.note}</svg>`;
}
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon || "note");
  });
}
