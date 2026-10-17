# Editor component

Adapted from github.com/charmbracelet/bubbles/textarea v0.21.0 (MIT).
The upstream license is preserved in LICENSE and the distributed third-party
notices. Keep future upstream fixes reviewable against that pinned version.

Local additions live in selection.go. Source rune offsets determine selection
ranges; rendering uses the component's own wrapped rows and viewport. Wrapping
preserves source text and whole grapheme clusters, and vertical movement uses
that wrapped grid instead of guessed offsets. textarea.go contains the selection
fields, calls the source-span renderer, scrolls after refreshing viewport content,
and clears selection when replacing/resetting the value. Tabs stay in the source
instead of expanding to spaces; cellWidth and displayText draw each tab as four
cells, and textarea.go measures text with cellWidth. sourceSanitizer also keeps
U+FFFD and drops only control characters. Clipboard I/O and paste
validation remain owned by the app.
