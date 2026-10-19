# Toward 1.5.0

Working ideas from the 2026-10-20 conversation. Build and refine with the user;
this document does not authorize a release tag.

## Agreed direction

- Keep the Labrador logo prominent without a sidebar-toggle icon to its left.
- Collapsing the notes panel should leave a useful icon rail. Notes, search,
  recent notes, creation, settings and commands must remain reachable.
- Keep Back available while its eventual home is explored.
- One search entry point with explicit All notes / This note scopes.
- Recently opened notes, distinct from recently modified notes.
- Pin important notes without modifying their Markdown.
- Clickable folder breadcrumbs.
- Clean up command access and reduce header clutter.
- Truncated note titles must reveal their complete title in a themed tooltip,
  including keyboard focus. Keep rename discoverable.
- Rebuild and restart the review server after each visible batch and tell the
  user to reload http://127.0.0.1:4280. Preview upcoming work as 1.5.0+dev.

## Implementation choices to review as they become visible

- Persistent rail, with the logo returning home and a Notes button toggling
  the adjacent panel. Phone notes remain a drawer.
- Recent notes get a compact panel view; pins get a section in Notes.
- The rail provides Commands (the existing searchable command palette).
  Consolidate the four document menus once command discoverability is covered.
- Search scope switching should preserve the query; existing full-text result
  previews and find-and-replace remain useful.
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
