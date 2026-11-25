package main

import "golang.org/x/sys/windows"

func supportDirectory() (string, error) {
	return windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
}

// The per-user installer owns registration and replacement on Windows.
func setupWindow(string)            {}
func readyForAccounts(string) error { return nil }
