package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type registration struct {
	ClientID string `json:"id"`
	Subject  string
	Email    string `json:"email"`
}
type session struct {
	Access  string
	Refresh string
	Scope   string
	Expires time.Time
}
type state struct {
	Format        int    `json:",omitempty"`
	LegacyDigest  string `json:",omitempty"`
	PendingClient string
	Accounts      []registration
	Generation    int
	HostID        string
	Registration  registration
	Session       *session
}
type vault struct{ directory string }

// Atomic replacement keeps a rotating refresh token and its expiry in one transaction.
func atomicWrite(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".margin-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func (v vault) transaction(ctx context.Context, fn func(*state) (bool, error)) error {
	if err := os.MkdirAll(v.directory, 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(v.directory, "session.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	for {
		busy, err := tryLock(f, true)
		if err != nil {
			return err
		}
		if !busy {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(40 * time.Millisecond):
		}
	}
	s, err := v.load()
	if err != nil {
		return err
	}
	save, result := fn(&s)
	if save {
		err = v.save(s)
		if err != nil {
			return err
		}
	}
	return result
}

// load runs under the provider lock, including during legacy migration.
func (v vault) load() (state, error) {
	var saved state
	protected, err := records.read(v.directory)
	found := err == nil
	if found {
		if json.Unmarshal(protected, &saved) != nil || saved.Format != 1 {
			return state{}, errors.New("Margin Connect could not read its protected account.")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return state{}, err
	}
	legacy := filepath.Join(v.directory, "session.json")
	data, err := os.ReadFile(legacy)
	if errors.Is(err, os.ErrNotExist) {
		return saved, nil
	}
	if err != nil {
		return state{}, err
	}
	var migrated state
	if json.Unmarshal(data, &migrated) != nil {
		return state{}, errors.New("Could not read the previous Margin account.")
	}
	migrated.Format = 1
	migrated.LegacyDigest = fmt.Sprintf("%x", sha256.Sum256(data))
	expected, err := json.Marshal(migrated)
	if err != nil {
		return state{}, err
	}
	if !found {
		if err = records.write(v.directory, expected); err != nil {
			return state{}, err
		}
		protected, err = records.read(v.directory)
	}
	if err != nil || !bytes.Equal(protected, expected) {
		return state{}, errors.New("Could not verify the protected account. The previous account file was preserved.")
	}
	saved = migrated
	if err = os.Remove(legacy); err != nil {
		return state{}, err
	}
	return saved, nil
}
func (v vault) save(s state) error {
	s.Format = 1
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return records.write(v.directory, data)
}

type systemRecords struct{}

var records systemRecords

// A different browser can disconnect this account while a stream is open.
func (v vault) watchSession(ctx context.Context, cancel context.CancelFunc, generation int) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// The request already completed migration. Both backing stores replace a record atomically.
			data, err := records.read(v.directory)
			var current struct {
				Generation int
				Session    *struct{}
				Format     int
			}
			if err != nil || json.Unmarshal(data, &current) != nil || current.Format != 1 || current.Session == nil || current.Generation != generation {
				cancel()
				return
			}
		}
	}
}

// Hold a shared lock for an operation's lifetime so uninstall cannot race an in-flight login.
func openHostLock(directory string, exclusive bool) (*os.File, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(directory, "host.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	busy, err := tryLock(f, exclusive)
	if busy {
		err = errors.New("Margin Connect is in use. Finish the active operation and try again.")
	}
	if err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func hostLock(directory string, removing bool) (*os.File, error) {
	f, err := openHostLock(directory, removing)
	if err != nil {
		return nil, err
	}
	err = readyForAccounts(directory)
	marker := filepath.Join(directory, "removing")
	if err == nil && removing {
		err = os.WriteFile(marker, nil, 0600)
	}
	if err == nil && !removing {
		if _, probe := os.Stat(marker); probe == nil {
			err = errors.New("Margin Connect is being removed. Finish uninstalling or run the installer again.")
		} else if !errors.Is(probe, os.ErrNotExist) {
			err = probe
		}
	}
	if err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
