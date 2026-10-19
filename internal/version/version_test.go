package version

import (
	"strings"
	"testing"
)

func TestString(t *testing.T) {
	if got := String(); !strings.HasPrefix(got, "dev") && !strings.HasPrefix(got, "v") {
		t.Fatalf("unstamped version %q", got)
	}
	Version = "v9.9.9"
	t.Cleanup(func() { Version = "" })
	if String() != "v9.9.9" {
		t.Fatal("ldflags version ignored")
	}
}
