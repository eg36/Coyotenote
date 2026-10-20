# Write action inventory

Inventory for [#14](https://github.com/eg36/Labradorite/issues/14), checked
against the application at `25ffb15`, including the task controls from #11.
This records current entry points and missing sidebar access. It does not
approve a layout: #14 requires coordination with the #8 interface brainstorm.

“Sidebar” means the Text formatting panel opened with Format. “Command” means
the quick-open command palette. Mod means Ctrl on Windows/Linux and Command on
macOS. Input rules convert typed Markdown; source-only creation means using
Markdown view before returning to Write.

## Formatting and structure

| Action | Sidebar now | Other current entry points | Sidebar work remaining |
| --- | --- | --- | --- |
| Normal paragraph; headings 1–6 | Paragraph style picker | Mod+Alt+0–6; Markdown heading input | None for access; retain selection/disabled state |
| Bold; italic | Buttons | Mod+B / Mod+I; Markdown input | None for access |
| Strikethrough | Button | Mod+Shift+S; Markdown input | None for access |
| Inline code | Button | Markdown input and editor shortcut | None for access |
| Highlight: yellow/default, red, orange, green, blue, purple | Colour swatches | `==…==`, including colour prefixes | None for access; retain exact markers and fallback boundaries |
| Bullet; numbered; task list | Buttons | Insert → Checklist; Markdown input; editor list shortcuts | None for creating/toggling the list |
| Task status; Open/Done toggle | In-document native status picker and checkbox | Type task syntax; picker supports mouse, touch and keyboard | Decide sidebar selection-aware status access |
| Nest/unnest list items | No | Tab / Shift+Tab in lists | Add discoverable controls |
| Blockquote | Button | Insert → Quote; `> ` input | None for access |
| Fenced code block | No | Markdown fence input; Mod+Alt+C | Add a code-block control; consider language editing |
| Horizontal rule | No | Markdown rule input/source | Add an insert control |
| Hard line break | No | Shift+Enter | Add an insert control if all supported insertions are to be represented |
| Split/leave a block or list | No dedicated button | Enter; empty-item Enter; code-block exit keys | Account for these structural editing actions in the interaction design |

## Insertion and document editing

| Action | Sidebar now | Other current entry points | Sidebar work remaining |
| --- | --- | --- | --- |
| Ordinary link; remove a link | Link dialog button | Insert → Link; link dialog; Markdown syntax | Keep selection-aware editing/removal discoverable |
| Wiki link, alias, heading or block target | Note-link dialog button | Insert → Link to a note; `[[…]]` input | Existing insertion; expose supported target/alias editing clearly |
| Image attachment | Image button | Insert → Image; Insert image command; paste/drop | Existing insertion; decide controls for description and supported size syntax |
| Table | Insert table button (3×3, header row) | Insert → Table; Markdown table input/source | Existing insertion; inventory table editing separately below |
| Numbered/named footnote reference | No | Type `[^label]`; activate a reference to visit its definition | Add reference insertion and label choice |
| Numbered/named footnote definition | No | Create in Markdown; existing definitions have editable source fields in Write | Add definition creation; preserve exact source/gaps and multiline indentation |
| Inline footnote | No | Type `^[…]`; existing inline notes have an edit field | Add insertion/edit access |
| Inline formula | No | `$…$` input; existing formula opens a TeX editor | Add insertion/edit access |
| Display formula | No | `$$` then Enter; source syntax; existing formula opens a TeX editor | Add insertion/edit access |
| Mermaid diagram | No | Mermaid fence in Markdown; parsed diagrams have a source editor | Add diagram creation/edit access |
| Callout | No | Type `[!type] ` at the start of a quote; existing callout header edits type/title/folding | Add creation and selection-aware header access |
| Markdown comment | No | Type `%%…%%`; Write shows it literally, Preview hides it | Add a comment action without implying a hidden rich comment editor exists |
| Properties/front matter | No | Add properties command; property fields/raw YAML above the document; Markdown for complex syntax | Add a discoverable entry point; keep typed/raw fallbacks |
| Cut/copy/paste; select all | No | Native browser/editor keyboard and clipboard interaction; image paste handler | Account for clipboard permissions and selection in proposed controls |
| Undo/redo edits | Buttons under History | Edit menu; Mod+Z / Mod+Shift+Z | Existing access; distinguish it from stored note versions |
| Save now | No | Edit → Save now; command; Mod+S; autosave | Add access if the editing group includes explicit save |
| Find/replace in this note | No | Edit → Find and replace; command; source-editor Mod+F | Add access and retain search scope/view restoration |
| Stored note history and restore | No | Header history button; File → Note history; command | Add access distinct from undo/redo |

Tables support cell text editing and keyboard navigation now: Tab advances to
the next cell and can append a row at the end; Shift+Tab goes back. The installed
TableKit also provides row/column insertion/deletion, header/alignment and
merge/split commands, but the app does not expose those as a table-editing UI.
They must not be presented as already implemented user controls. Their eventual
sidebar scope needs an explicit decision, particularly for layouts Markdown
cannot represent exactly.

## Existing behavior to retain

- Formatting controls report active marks/block style. The sidebar is available
  only for an open note in Write, and opens as a drawer on narrow screens.
- Draft acknowledgement and busy operations disable editing. New controls need
  equivalent guards, keyboard access and selection preservation.
- Links/images, tables, footnote source, formula/diagram fields and callout
  headers already have distinct editing interactions. Sidebar insertion should
  reuse those behaviors and exactness guarantees.
- Source fallbacks remain necessary for HTML, note/file embeds, unsupported
  footnote/task/callout layouts and formatting spanning wiki links or images.
  A sidebar button must not silently bypass a fallback or rewrite the note.
- Markdown-only multi-cursor/folding tools are separate editor features, not
  existing Write actions. Settings, navigation, pins, rename/move, trash and
  downloads are document/workspace actions already elsewhere in the UI; their
  placement belongs to the wider interface discussion.

## Sources checked

- [Sidebar controls](../web/index.html), [visibility and phone behavior](../web/src/formatting.ts)
- [Write extensions, commands and fallbacks](../web/src/rich.ts), [editing and read-only state](../web/src/editor.ts)
- [Menus](../web/src/menus.ts), [commands](../web/src/palette.ts), [app shortcuts](../web/src/shortcuts.ts)
- [Tasks](../web/src/task-status.ts), [properties](../web/src/properties.ts), [footnotes](../web/src/footnotes.ts)
- [Math](../web/src/write-math.ts), [Mermaid](../web/src/write-diagrams.ts), [callouts](../web/src/write-callout.ts)
- [User guide](GUIDE.md), including supported syntax and exact-saving limitations
- Installed Tiptap 3.32.0 keymaps for lists, paragraphs/headings, marks,
  code blocks, hard breaks and tables, as enabled by the registered extensions
