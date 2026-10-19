package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/eg36/coyotenote/internal/vault"
)

// safeName turns a note title into a portable file name: characters that are
// invalid in file names or links become "-", and the result is at most 100 runes.
func safeName(t string) string {
	name := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\<>:"|?*[]#^`, r) || r < 32 {
			return '-'
		}
		return r
	}, t)
	if runes := []rune(name); len(runes) > 100 {
		name = string(runes[:100])
	}
	name = strings.TrimLeft(strings.TrimRight(strings.TrimSpace(name), ". "), ".")
	if vault.CheckName(name) != nil {
		return "Untitled"
	}
	return name
}

type migration struct{ from, to string }

// planMigration names each legacy timestamp note after its title, adding
// " 2", " 3"… on collisions with other notes or earlier renames.
func planMigration(notes []vault.Note) []migration {
	var plan []migration
	taken := make([]vault.Note, 0, len(notes))
	for _, n := range notes {
		if !vault.LegacyID.MatchString(n.ID) {
			taken = append(taken, n)
		}
	}
	for _, n := range notes {
		if !vault.LegacyID.MatchString(n.ID) {
			continue
		}
		to := vault.FreeName(taken, "", safeName(vault.Title(n.Body)))
		taken = append(taken, vault.Note{ID: to})
		plan = append(plan, migration{n.ID, to})
	}
	return plan
}

// migrate renames legacy notes after asking on in/out. It stops at the first
// failure; notes renamed until then keep their new names.
func migrate(s *vault.Store, in io.Reader, out io.Writer) error {
	notes, _, err := s.Load()
	if err != nil {
		return err
	}
	plan := planMigration(notes)
	if len(plan) == 0 {
		fmt.Fprintln(out, "No notes with timestamp names in", s.Dir)
		return nil
	}
	for _, step := range plan {
		fmt.Fprintf(out, "  %s.md → %s.md\n", step.from, step.to)
	}
	fmt.Fprintf(out, "Rename %d notes in %s? [y/N] ", len(plan), s.Dir)
	answer, _ := bufio.NewReader(in).ReadString('\n')
	if strings.ToLower(strings.TrimSpace(answer)) != "y" {
		fmt.Fprintln(out, "Nothing was renamed.")
		return nil
	}
	bodies := make(map[string]string, len(notes))
	for _, n := range notes {
		bodies[n.ID] = n.Body
	}
	for i, step := range plan {
		err := s.Rename(vault.Note{ID: step.from, Body: bodies[step.from]}, step.to)
		var moved vault.MovedSyncError
		if err != nil && !errors.As(err, &moved) {
			return fmt.Errorf("renamed %d of %d notes; %s: %w", i, len(plan), step.from, err)
		}
	}
	fmt.Fprintf(out, "Renamed %d notes.\n", len(plan))
	return nil
}
