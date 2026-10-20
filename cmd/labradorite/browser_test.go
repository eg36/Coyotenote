package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

// The test executable stands in for the OS browser launcher. Exercise the real
// process launch without opening a browser or depending on desktop availability.
func TestMain(m *testing.M) {
	if record := os.Getenv("LABRADORITE_TEST_BROWSER_RECORD"); record != "" {
		data, _ := json.Marshal(os.Args[1:])
		if err := os.WriteFile(record, data, 0600); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestDefaultBrowserLaunch(t *testing.T) {
	launcher := "xdg-open"
	args := []string{"http://127.0.0.1:4280"}
	switch runtime.GOOS {
	case "windows":
		launcher = "rundll32.exe"
		args = append([]string{"url.dll,FileProtocolHandler"}, args...)
	case "darwin":
		launcher = "open"
	default:
		t.Setenv("DISPLAY", ":test")
	}
	dir := t.TempDir()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, launcher), data, 0700); err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(dir, "browser.json")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("LABRADORITE_TEST_BROWSER_RECORD", record)
	openBrowser("http://127.0.0.1:4280")
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		data, err = os.ReadFile(record)
		var got []string
		if err == nil && json.Unmarshal(data, &got) == nil {
			if !reflect.DeepEqual(got, args) {
				t.Fatalf("browser args: %v, want %v", got, args)
			}
			// Windows cannot unlink a running executable. The race runtime may
			// briefly remain alive after writing the launch record.
			for time.Now().Before(deadline) {
				if err := os.Remove(filepath.Join(dir, launcher)); err == nil {
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
			t.Fatal("browser launcher did not exit")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("default browser launcher was not invoked")
}
