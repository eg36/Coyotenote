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
- The rail provides Commands (the existing searchable command palette).
  File / Edit / View / Insert and the writing-mode selector stay centered at
  the top, with note actions part of the same centered menu group. Formatting controls live in a
  collapsible panel LEFT of the document, after Notes, opened from the rail.
  Keep the mode selector directly after Insert; do not recreate a toolbar row.
  Center the home menu both ways, leave its title blank, and remove the old
  vertical divider from the header.
- Search scope switching should preserve the query; existing full-text result
  previews remain available. This note retains case, whole-word, regex and
  replacement controls, and restores the prior writing mode when closed.
- Browser preferences stay scoped to the vault where appropriate. Renaming,
  moving and trashing notes must not leave broken pins or recent-note entries.

## Further ideas, not yet committed to this release

- A useful start page with recent notes, pins and quick capture.
- Unlinked mentions and one-click conversion to wiki links.
- Quick capture to Inbox or today's note.
- Workspace memory: sidebar width, outline and scroll positions.
- Tabs versus richer navigation history; do not add tabs by default.

## Preserve

Plain Markdown vault format, save/conflict/draft protections, existing themes,
keyboard access, phone workflows, and the published v1.0.0 release.
