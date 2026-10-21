---
tags: [lab, embeds, review]
---

# Embed Editing Workshop

In Write, every embed has an Edit embed button. Change its target or URL and its optional label, then Apply. Enter applies from either text field; Cancel or Escape keeps the source unchanged.

## Edit a web URL and label

![[https://example.com/|A page to edit]]

- [ ] Choose Edit embed. Change the URL to https://example.com/?review=2 and the label to My revised page.
- [ ] Apply. The destination and label should update; no page should load automatically.
- [ ] Press Ctrl/⌘ Z to undo the edit. The original URL and label should return.
- [ ] Open Edit embed again, type another URL, then press Escape. Nothing should change.
- [ ] If web embeds are enabled, Load the page, then edit its URL. Applying should unload the old page and wait for Load again.

## Edit a local section

![[Lab/Web Embed Workshop#Start with loading off|A local note section]]

- [ ] Choose Edit embed and change the label to A section from the web workshop.
- [ ] Change the heading in the target to Lab/Web Embed Workshop#Try it, then Apply.
- [ ] The embedded section should change. Undo should restore its previous target and label.

Local note and file embeds use the same editor. A target can be a note, Note#Heading, Note#^block-id or an attachment path. For images, the label can include a width such as 200 or a size such as 200x150.

## Check the source

Switch to Markdown to inspect the two `![[…]]` expressions. Cancel and unchanged Apply preserve their original source; edits elsewhere leave them untouched. A changed web embed always waits for Load, even after Undo or a reload.

Editing and validating a URL does not contact its service. Loading is still controlled by Settings → Web embeds and the individual Load embed button.
