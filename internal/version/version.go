// Package version reports the version coyotenote prints. A release stamps it
// into the binary, so the app always says which release it came from.
package version

import "runtime/debug"

// Version is set at build time with
// -ldflags "-X github.com/eg36/coyotenote/internal/version.Version=v1.2.3".
var Version = ""

// String returns Version, else the module version recorded by go install,
// else "dev" followed by the commit it was built from when that is known.
func String() string {
	if Version != "" {
		return Version
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	if info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	for _, setting := range info.Settings {
		if setting.Key == "vcs.revision" && len(setting.Value) >= 7 {
			return "dev (" + setting.Value[:7] + ")"
		}
	}
	return "dev"
}
