package main

import (
	"errors"
	"io/fs"
	"os"

	"github.com/eg36/labradorite/internal/vault"
)

const welcomeID = "Welcome to Labradorite"

// welcomeBody is plain Markdown the Write view keeps intact. Examples stay
// in code spans, so the note adds no tags or links to the notebook.
const welcomeBody = `# Welcome to Labradorite

This notebook is a folder of plain Markdown files on your computer. Every note is an ordinary ` + "`.md`" + ` file that any editor can open, and that you can back up, sync or move like other files.

## Getting around

- **New note:** the button at the top of the sidebar, or Ctrl/⌘ N.
- **Quick open:** Ctrl/⌘ K finds notes, headings and commands.
- **Search:** the box at the top searches inside every note.
- **Today's note:** Alt J opens a note for today in the Journal folder.
- **Shortcuts:** F1 lists them all.

## Writing

Write here as in a document, or switch to **Markdown**, **Preview** or **Split** above the text. Changes save on their own.

- Link notes by name in double brackets, such as ` + "`[[Ideas]]`" + `. The footer counts the notes that link to the one you are reading.
- Tag notes with words such as ` + "`#travel`" + ` anywhere in the text; the sidebar filters by tag.
- A name like ` + "`Projects/Plan`" + ` puts a note in the Projects folder.
- Notes in a ` + "`Templates`" + ` folder can be the starting text of new notes.

## Nothing is lost quietly

Saves never overwrite changes made in another program or tab; you compare and choose. Deleted notes go to the trash, and History keeps earlier versions of each note.

Delete this note whenever you like, or keep it for reference.
`

// firstRun reports whether dir does not exist yet, so Labradorite is about
// to create its default notebook for the first time.
func firstRun(dir string) bool {
	_, err := os.Stat(dir)
	return errors.Is(err, fs.ErrNotExist)
}

// welcome writes the welcome note into a new notebook.
func welcome(s *vault.Store) error {
	_, err := s.Create(welcomeID, welcomeBody)
	return err
}
