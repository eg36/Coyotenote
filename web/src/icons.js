const paths = {
  coyote:
    '<path d="m3 3 7 4 4-4 7 2-3 12-6 4-7-4Z"/><path d="m3 3 4 9 5 3 6-3 3-7M7 12l1-4m10 4-2-4m-6 8h4m-2 0v3"/>',
  vault:
    '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 5V3h8v2m-4 5v5m-3-2h6"/>',
  notebook:
    '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4m-4 5h4m-4 5h4m6-10h4m-4 4h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevronDown: '<path d="m7 10 5 5 5-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  sidebar:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
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
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.note}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
