package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var storeID string // Set only for an extension with a published Chrome Web Store listing.
func install(support, executable string, browsers []string) error {
	allowed := strings.Fields(origins)
	if len(allowed) == 0 {
		return errors.New("Missing extension identity.")
	}
	destination := filepath.Join(support, "Margin", "Connect")
	if err := os.MkdirAll(destination, 0700); err != nil {
		return err
	}
	binary := filepath.Join(destination, "MarginConnect")
	contents, err := os.ReadFile(executable)
	if err != nil {
		return err
	}
	if err = atomicWrite(binary, contents, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(message{"name": hostName, "description": "Margin Connect", "type": "stdio", "path": binary, "allowed_origins": allowed})
	if err != nil {
		return err
	}
	for _, browser := range browsers {
		dir := filepath.Join(browser, "NativeMessagingHosts")
		if err = os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		if err = atomicWrite(filepath.Join(dir, hostName+".json"), data, 0600); err != nil {
			return err
		}
	}
	return nil
}
func setupWindow(support string) {
	binary, err := os.Executable()
	if err == nil {
		err = install(support, binary, []string{filepath.Join(support, "Google", "Chrome"), filepath.Join(support, "Microsoft Edge")})
	}
	msg := "Margin Connect is ready. Return to Margin in your browser to continue."
	if err != nil {
		msg = "Margin Connect could not finish setup. " + err.Error()
	}
	script := `on run argv
 display dialog (item 1 of argv) with title "Margin Connect" buttons {"OK"} default button "OK"
 end run`
	if err == nil && storeID != "" {
		script = `on run argv
 set choice to button returned of (display dialog (item 1 of argv) with title "Margin Connect" buttons {"Get the extension", "Done"} default button "Done")
 if choice is "Get the extension" then open location (item 2 of argv)
 end run`
	}
	cmd := exec.Command("/usr/bin/osascript", "-e", script, msg, fmt.Sprintf("https://chromewebstore.google.com/detail/%s", storeID))
	cmd.Run()
}
