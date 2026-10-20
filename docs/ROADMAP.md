# 1.5.0 release candidate and the road to 2.0

Working ideas from the 2026-10-20 conversation. Build and refine with the user;
this document does not authorize a release tag.

The 1.5 feature set is implemented. Release preparation is tracked in
[#13](https://github.com/eg36/Labradorite/issues/13); `v1.5.0` will be tagged
only after explicit approval. Review builds remain `1.5.0+dev` until release.
GitHub issues are the source of truth and Linear team Labradorite mirrors them.

## Agreed direction

- Keep the Labrador logo prominent without a sidebar-toggle icon to its left.
- Collapsing the notes panel should leave a useful icon rail. Notes, search,
  recent notes, creation, settings and commands must remain reachable.
- Previous/Next visited-note arrows live after the shared folder-collapse icon;
  a small panel-close control stays at the far right of that row.
- One search entry point with explicit All notes / This note scopes.
- Recently opened notes, distinct from recently modified notes.
- Pin important notes without modifying their Markdown.
- Clickable folder breadcrumbs.
- Clean up command access and reduce header clutter.
- Truncated note titles must reveal their complete title in a themed tooltip,
  including keyboard focus. Keep rename discoverable.
- Rebuild and restart the review server after each visible batch and tell the
  user to reload http://127.0.0.1:4280. Preview upcoming work as 1.5.0+dev.

## Implemented choices

- Persistent rail, with the logo returning home and a Notes button toggling
  the adjacent panel. Phone notes remain a drawer.
- Recent notes get a compact panel view; collapsible title/date pins sit below
  tags and above Notes. Folder and pin collapse choices survive reloads.
- Rail shortcuts can be dragged or reordered with Alt+Shift+↑/↓ and remember
  their order in the browser. Keep the logo and bottom utility group anchored.
- Put the larger note title above the centered menu row; leave the title area
  blank at home. Keep the full-title tooltip for truncated paths.
- The rail provides Commands (the existing searchable command palette). The
  header's left end, beside the logo, holds the Write / Markdown / Preview /
  Split selector and a labelled Format toggle for the formatting panel LEFT of
  the document. File / Edit / View / Insert stay centered with outline,
  history, download and trash; pin sits right after the note title. Center the
  home menu both ways, leave its title blank, and keep the header divider-free.
- Open rail panels show an accent bar at the rail's edge instead of a filled
  icon; every rail icon shares one neutral hover.
- Search scope switching should preserve the query; existing full-text result
  previews remain available. This note retains case, whole-word, regex and
  replacement controls, and restores the prior writing mode when closed.
- Folder breadcrumb glyphs use the text baseline and font cap height, with
  measured font metrics as a fallback for older browsers.
- Browser preferences stay scoped to the vault where appropriate. Renaming,
  moving and trashing notes must not leave broken pins or recent-note entries.

## Milestones toward 1.5.0

Internal milestones only: no tag or release until the user approves 1.5.0.
Builds stay stamped `1.5.0+dev`. Each item is its own focused commit with tests.

### 1.2.0 — Extended Markdown syntax in Preview
- `==highlight==`, including `==🔴text==` colour variants; Write keeps `==`.
- `%%comments%%` (inline and block) hidden in Preview.
- Footnotes in Preview: `[^1]`, named `[^note]`, inline `^[text]`.
- Callouts: `> [!type] Title`, all common types and aliases, `+`/`-`
  folding, nesting, title-only; unknown types fall back to note.
- Same-note `[[#Heading]]` links, and `^block-id` targets for `[[Note#^id]]`.
- Custom task marks such as `[?]`, `[-]`, `[>]` rendered distinctly.
- Image sizes: `![[image.png|100]]`, `|100x145`, `![alt|100](url)`.

### 1.3.0 — Editing power and richer rendering
- Markdown editor: fold headings and lists, multiple cursors (Alt+click),
  rectangular selection, select next match.
- Note, heading and block embeds `![[Note]]`, `![[Note#Heading]]`,
  `![[Note#^id]]` in Preview, with depth and cycle limits.
- A sanitised HTML allowlist in Preview (`u s sub sup kbd mark details summary
  br` and similar); scripts, styles, iframes and event handlers stay blocked.
- A typed Properties editor in Write that still saves plain YAML.
- Math (`$…$`, `$$…$$`) and Mermaid diagrams, bundled and loaded only by notes
  that use them; no network requests.

### 1.4.0 — Footnotes in Write
- Write edits footnotes and keeps their Markdown exact, so footnoted notes no
  longer fall back to Markdown view.
- Align the breadcrumb folder icon with the folder name in every browser.

### 1.5.0 — Smooth everything, then release
- Custom task statuses in Write: editable status pickers with exact markers,
  spacing and nested tasks; unsupported list layouts keep the source fallback.
- Inline `^[…]` footnotes in Write: edit their Markdown in place, preserve
  nested brackets and escapes, and validate changes before applying.
- Math in Write: inline and display formulas render with the bundled KaTeX,
  open their TeX for editing in place, and keep delimiters and spacing exact.
- Mermaid in Write: diagrams use the same lazy offline renderer as Preview;
  click or Enter opens the source with live rendering, Apply, Cancel and undo,
  preserving fences, language lines, source indentation and nested spacing.
- Callouts in Write (moved up from 1.6): shown as in Preview, with the type,
  title and folding edited in the header and the first line kept exactly.
- Exact saving from Write: blocks you do not edit, and the gaps between them,
  are saved as written; edited text keeps its escapes, delimiters, markers,
  fences and table rows, and typed characters are escaped only when needed.
- Rename a note in place: clicking the title turns it into a text field
  (Enter renames, Escape cancels, a folder path moves the note), instead of
  opening the rename dialog.
- Theme picker: a Light / Dark switch above the list shows only themes of the
  chosen kind; search and keyboard preview work within that list. The chosen
  filter is remembered, and the confirmation names only the selected theme.
- User-led polish and fixes across all of the above, full regression runs,
  guide and release notes; release only on the user's word.

## After 1.5.0: internal 1.6–1.9 toward the 2.0.0 release

Like 1.1–1.4, milestones 1.6 to 1.9 are internal and never tagged; 2.0.0 is
the next public release after 1.5.0.
After the 1.5.0 release, development builds will be stamped `2.0.0+dev`.

- [#8](https://github.com/eg36/Labradorite/issues/8): rethink the interface,
  beginning with a user-led brainstorm before implementation.
- [#11](https://github.com/eg36/Labradorite/issues/11): make custom task
  statuses look consistent in Write and Preview.
- [#12](https://github.com/eg36/Labradorite/issues/12): edit only the note
  name inline while preserving its folder; keep moving in Rename or move….

## 1.6.0 — Maintainable code, full documentation

- Keep issue-based development, with GitHub as the source of truth and Linear
  mirrors assigned, labelled and placed in the right project. Continue focused
  commits on main until a switch to branches and pull requests is approved.
- Reread the whole codebase and make it easy for people to maintain and
  read: clear structure, names and comments, no dead code.
- Full technical documentation: architecture, data flow, vault format and
  safety rules, frontend and server internals, testing and release process.

## 2.0.0 and later

- Write support for embeds and HTML, so fewer notes fall back to Markdown
  view.
- PDF, audio and video attachments and embeds.
- Web page, YouTube and similar embeds, opt-in because they contact the
  network.

## Further ideas, not yet committed to this release

- A useful start page with recent notes, pins and quick capture.
- Unlinked mentions and one-click conversion to wiki links.
- Quick capture to Inbox or today's note.
- Workspace memory: sidebar width, outline and scroll positions.
- Tabs versus richer navigation history; do not add tabs by default.

## Preserve

Plain Markdown vault format, save/conflict/draft protections, existing themes,
keyboard access, phone workflows, and the published v1.0.0 release.
