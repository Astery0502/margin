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
func install(support, executable, hostName string, browsers []string) error {
	allowed := strings.Fields(origins)
	if len(allowed) == 0 {
		return errors.New("Missing extension identity.")
	}
	destination := filepath.Join(support, "Margin", "Connect")
	lock, err := openHostLock(destination, true)
	if err != nil {
		return err
	}
	defer lock.Close()
	binary := filepath.Join(destination, "MarginConnect")
	contents, err := os.ReadFile(executable)
	if err != nil {
		return err
	}
	if err := checkPreviousHost(destination, true); err != nil {
		return err
	}
	// Keep the old inode reachable until every process launched before replacement exits.
	previous := filepath.Join(destination, "previous-host")
	if err := os.Link(binary, previous); err != nil && !errors.Is(err, os.ErrNotExist) && !errors.Is(err, os.ErrExist) {
		return err
	}
	if err = atomicWrite(binary, contents, 0700); err != nil {
		os.Remove(previous)
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
	err = os.Remove(filepath.Join(destination, "removing"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func setupWindow(support string) {
	browsers := []string{filepath.Join(support, "Google", "Chrome"), filepath.Join(support, "Microsoft Edge")}
	dir := filepath.Join(support, "Margin", "Connect")
	installed := filepath.Join(dir, "MarginConnect")
	if _, err := os.Stat(installed); err == nil {
		result, err := exec.Command("/usr/bin/osascript", "-e", `button returned of (display dialog "Margin Connect is installed for Chrome and Edge. Removing it disconnects both accounts for this user." with title "Margin Connect" buttons {"Cancel","Remove","Update"} default button "Update" cancel button "Cancel")`).Output()
		if err != nil {
			return
		}
		if strings.TrimSpace(string(result)) == "Remove" {
			message, err := uninstallMac(dir, installed, browsers)
			if err != nil {
				message = "Could not finish removing Margin Connect. " + err.Error() + " Run the installer to retry."
			}
			exec.Command("/usr/bin/osascript", "-e", `on run argv
 display dialog (item 1 of argv) with title "Margin Connect" buttons {"OK"} default button "OK"
 end run`, message).Run()
			return
		}
	}
	binary, err := os.Executable()
	if err == nil {
		err = install(support, binary, "dev.margin.connect", browsers)
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

func supportDirectory() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support"), err
}
func readyForAccounts(directory string) error { return checkPreviousHost(directory, false) }
func checkPreviousHost(directory string, installing bool) error {
	previous := filepath.Join(directory, "previous-host")
	if _, err := os.Stat(previous); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	// The installer may still be replacing the executable. Leave the marker until it has switched.
	if active, err := os.Stat(filepath.Join(directory, "MarginConnect")); err == nil {
		old, err := os.Stat(previous)
		if err == nil && os.SameFile(active, old) {
			if installing {
				// A previous installer stopped after linking the old inode. Resume its replacement.
				return nil
			}
			return errors.New("Run the Margin Connect installer again to finish updating.")
		}
	}
	cmd := exec.Command("/usr/sbin/lsof", "-t", "--", previous)
	out, err := cmd.Output()
	var exit *exec.ExitError
	if len(out) > 0 || !errors.As(err, &exit) || exit.ExitCode() != 1 || len(exit.Stderr) > 0 {
		return errors.New("Close the previous Margin Connect sessions in Chrome and Edge, then try again.")
	}
	err = os.Remove(previous)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func uninstallMac(dir, installed string, browsers []string) (string, error) {
	// An older binary does not implement account cleanup. Upgrade it before removing.
	output, err := exec.Command(installed, "--remove-accounts").CombinedOutput()
	message := "Margin Connect was removed."
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 2 {
		message += " Confirm disconnection in ChatGPT Settings."
	} else if err != nil {
		return "", fmt.Errorf("Account cleanup failed. %s", strings.TrimSpace(string(output)))
	}
	if _, err := os.Stat(filepath.Join(dir, "removing")); err != nil {
		return "", errors.New("Update Margin Connect before removing it.")
	}
	for _, browser := range browsers {
		err := os.Remove(filepath.Join(browser, "NativeMessagingHosts", "dev.margin.connect.json"))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	for _, file := range []string{"DeepSeek/session.lock", "DeepSeek", "session.lock", "host.lock", "previous-host", "MarginConnect", "removing"} {
		if err := os.Remove(filepath.Join(dir, file)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	return message, os.Remove(dir)
}
