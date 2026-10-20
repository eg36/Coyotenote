# Toward 1.5.0

Working ideas from the 2026-10-20 conversation. Build and refine with the user;
this document does not authorize a release tag.

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

### 1.5.0 — Smooth everything, then release
- User-led polish and fixes across all of the above, full regression runs,
  guide and release notes; release only on the user's word.

## 2.0.0 and later

- Write support for embeds, callouts and HTML, so fewer notes fall back to
  Markdown view.
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
