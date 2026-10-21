package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// builtinPlugins lists the plugins the shell can host, in switcher order.
// Every plugin is optional; one the settings do not mention is enabled, so
// vaults saved before a plugin existed open with it.
var builtinPlugins = []string{"notes"}

// enabledPlugins reads which plugins the user turned on or off.
func (a *webApp) enabledPlugins() map[string]bool {
	enabled := map[string]bool{}
	for _, id := range builtinPlugins {
		enabled[id] = true
	}
	var saved map[string]bool
	if b, err := os.ReadFile(filepath.Join(a.store.Config, "plugins")); err == nil && json.Unmarshal(b, &saved) == nil {
		for id, on := range saved {
			if _, known := enabled[id]; known {
				enabled[id] = on
			}
		}
	}
	return enabled
}

// knownPlugins reports whether every ID in choice names a built-in plugin.
func knownPlugins(choice map[string]bool) bool {
	for id := range choice {
		known := false
		for _, builtin := range builtinPlugins {
			known = known || id == builtin
		}
		if !known {
			return false
		}
	}
	return true
}
