package main

type palette struct{ surface, chrome, text, muted, accent, cyan, good, warn, danger, line, pink, blue, onPill string }

type themeSpec struct {
	id, name string
	light    bool
	colors   palette
}

// Labradorite palettes take the logo's stone: slate surfaces with its blue,
// teal and green flashes, all at WCAG AA contrast. Keep the IDs so existing
// settings keep working.
var themes = []themeSpec{
	{"dark", "Labradorite Dark", false, palette{"#1B1F25", "#14171C", "#E7EBF0", "#A4ADBA", "#5AAEF2", "#5FD1DE", "#9DD67E", "#E3C36E", "#F28C86", "#303844", "#A3B4F7", "#5AAEF2", "#0D1824"}},
	{"light", "Labradorite Light", true, palette{"#FBFCFD", "#F0F3F6", "#1B2028", "#59636F", "#1F6DB5", "#0E7887", "#3B7630", "#8A6110", "#B13A3A", "#D6DCE4", "#5258C2", "#1F6DB5", "#FFFFFF"}},
}

// systemTheme follows the operating system's light or dark preference.
const systemTheme = "system"

// retiredThemes maps palettes that earlier versions offered to the
// Labradorite palette of the same brightness, so saved settings still open.
var retiredThemes = map[string]string{
	"ayu-dark": "dark", "ayu-mirage": "dark", "ayu-light": "light",
	"catppuccin-mocha": "dark", "catppuccin-macchiato": "dark", "catppuccin-frappe": "dark", "catppuccin-latte": "light",
	"nord": "dark", "tokyo-night": "dark", "dracula": "dark",
	"gruvbox-dark": "dark", "gruvbox-light": "light",
}

// validTheme reports whether id can be saved: a palette or System.
func validTheme(id string) bool {
	if id == systemTheme {
		return true
	}
	for _, t := range themes {
		if t.id == id {
			return true
		}
	}
	return false
}

// savedTheme reads a stored choice, opening a retired palette as the
// Labradorite palette of the same brightness and anything else as dark.
func savedTheme(id string) string {
	if validTheme(id) {
		return id
	}
	if mapped, ok := retiredThemes[id]; ok {
		return mapped
	}
	return "dark"
}
