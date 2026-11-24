package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
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
		err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(40 * time.Millisecond):
		}
	}
	var s state
	path := filepath.Join(v.directory, "session.json")
	data, err := os.ReadFile(path)
	if err == nil {
		if err = json.Unmarshal(data, &s); err != nil {
			return errors.New("Margin Connect could not read its saved account.")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	save, result := fn(&s)
	if save {
		data, err = json.Marshal(s)
		if err == nil {
			err = atomicWrite(path, data, 0600)
		}
		if err != nil {
			return err
		}
	}
	return result
}

// A different browser can disconnect this account while a stream is open.
func (v vault) watchSession(ctx context.Context, cancel context.CancelFunc, generation int) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			data, err := os.ReadFile(filepath.Join(v.directory, "session.json"))
			var current struct {
				Generation int
				Session    *struct{}
			}
			if err != nil || json.Unmarshal(data, &current) != nil || current.Session == nil || current.Generation != generation {
				cancel()
				return
			}
		}
	}
}
