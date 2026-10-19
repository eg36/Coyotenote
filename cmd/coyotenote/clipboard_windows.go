//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type desktopClipboard struct{}

var (
	clipboardUser32        = windows.NewLazySystemDLL("user32.dll")
	clipboardKernel32      = windows.NewLazySystemDLL("kernel32.dll")
	clipboardOpen          = clipboardUser32.NewProc("OpenClipboard")
	clipboardClose         = clipboardUser32.NewProc("CloseClipboard")
	clipboardEmpty         = clipboardUser32.NewProc("EmptyClipboard")
	clipboardGet           = clipboardUser32.NewProc("GetClipboardData")
	clipboardSet           = clipboardUser32.NewProc("SetClipboardData")
	clipboardCreateWindow  = clipboardUser32.NewProc("CreateWindowExW")
	clipboardDestroyWindow = clipboardUser32.NewProc("DestroyWindow")
	clipboardAlloc         = clipboardKernel32.NewProc("GlobalAlloc")
	clipboardFree          = clipboardKernel32.NewProc("GlobalFree")
	clipboardLock          = clipboardKernel32.NewProc("GlobalLock")
	clipboardUnlock        = clipboardKernel32.NewProc("GlobalUnlock")
	clipboardSize          = clipboardKernel32.NewProc("GlobalSize")
	clipboardMove          = clipboardKernel32.NewProc("RtlMoveMemory")
)

func clipboardWindowsError(action string, err error) error {
	if err == windows.ERROR_SUCCESS {
		return errors.New(action + " failed")
	}
	return fmt.Errorf("%s: %w", action, err)
}
func openWindowsClipboard(ctx context.Context) (func(), error) {
	// An owned message-only window gives SetClipboardData a valid owner without
	// showing UI. Clipboard operations and cleanup stay on this OS thread.
	class, _ := windows.UTF16PtrFromString("STATIC")
	hwnd, _, err := clipboardCreateWindow.Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 0, 0, ^uintptr(2), 0, 0, 0)
	if hwnd == 0 {
		return nil, clipboardWindowsError("create clipboard owner", err)
	}
	for {
		ok, _, _ := clipboardOpen.Call(hwnd)
		if ok != 0 {
			return func() { clipboardClose.Call(); clipboardDestroyWindow.Call(hwnd) }, nil
		}
		select {
		case <-ctx.Done():
			clipboardDestroyWindow.Call(hwnd)
			return nil, fmt.Errorf("clipboard is busy: %w", ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}
func (desktopClipboard) Read(ctx context.Context) (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	closeClipboard, err := openWindowsClipboard(ctx)
	if err != nil {
		return "", err
	}
	defer closeClipboard()
	handle, _, err := clipboardGet.Call(13)
	if handle == 0 {
		return "", clipboardWindowsError("read text clipboard", err)
	}
	size, _, err := clipboardSize.Call(handle)
	if size == 0 {
		return "", clipboardWindowsError("clipboard size", err)
	}
	if size > 2*(maxPasteBytes+1) {
		return "", errors.New("clipboard exceeds 1 MiB")
	}
	ptr, _, err := clipboardLock.Call(handle)
	if ptr == 0 {
		return "", clipboardWindowsError("lock clipboard", err)
	}
	defer clipboardUnlock.Call(handle)
	data := make([]uint16, int(size/2))
	if len(data) == 0 {
		return "", errors.New("clipboard text is empty or malformed")
	}
	clipboardMove.Call(uintptr(unsafe.Pointer(&data[0])), ptr, uintptr(len(data)*2))
	runtime.KeepAlive(data)
	text := windows.UTF16ToString(data)
	if len(text) > maxPasteBytes {
		return "", errors.New("clipboard exceeds 1 MiB")
	}
	return text, nil
}
func (desktopClipboard) Write(ctx context.Context, text string) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
	data, err := windows.UTF16FromString(text)
	if err != nil {
		return err
	}
	closeClipboard, err := openWindowsClipboard(ctx)
	if err != nil {
		return err
	}
	defer closeClipboard()
	handle, _, err := clipboardAlloc.Call(2, uintptr(len(data)*2))
	if handle == 0 {
		return clipboardWindowsError("allocate clipboard", err)
	}
	defer func() {
		if handle != 0 {
			clipboardFree.Call(handle)
		}
	}()
	ptr, _, err := clipboardLock.Call(handle)
	if ptr == 0 {
		return clipboardWindowsError("lock clipboard", err)
	}
	clipboardMove.Call(ptr, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)*2))
	runtime.KeepAlive(data)
	clipboardUnlock.Call(handle)
	ok, _, err := clipboardEmpty.Call()
	if ok == 0 {
		return clipboardWindowsError("empty clipboard", err)
	}
	ok, _, err = clipboardSet.Call(13, handle)
	if ok == 0 {
		return clipboardWindowsError("write clipboard", err)
	}
	handle = 0 // Ownership passed to Windows.
	return nil
}
