package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestRefreshFailurePreservesRegistration(t *testing.T) {
	v := vault{t.TempDir()}
	t.Cleanup(func() { records.remove(v.directory) })
	ctx := context.Background()
	err := v.transaction(ctx, func(s *state) (bool, error) {
		s.Registration = registration{"client", "subject", "reader@example.test"}
		s.Session = &session{Refresh: "synthetic"}
		return true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"refresh_token_reused"}`))
	}))
	defer server.Close()
	provider := provider{server.URL, resource, server.Client(), v}
	if _, err = provider.access(ctx, 0, false); !errors.Is(err, invalidGrant) {
		t.Fatalf("unexpected refresh result %v", err)
	}
	if err = v.transaction(ctx, func(s *state) (bool, error) {
		if s.Session != nil || s.Registration.ClientID != "client" {
			t.Fatal("lost account registration or retained invalid tokens")
		}
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(v.directory, "session.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unexpected legacy credential file")
	}
}

func TestMigrateAccounts(t *testing.T) {
	for _, session := range []*session{nil, {Access: "synthetic", Refresh: "rotating"}} {
		v := vault{t.TempDir()}
		t.Cleanup(func() { records.remove(v.directory) })
		legacy := filepath.Join(v.directory, "session.json")
		data, _ := json.Marshal(state{Generation: 17, Session: session, Registration: registration{ClientID: "registered"}})
		if err := os.WriteFile(legacy, data, 0600); err != nil {
			t.Fatal(err)
		}
		check := func(s *state) (bool, error) {
			if s.Generation != 17 || (s.Session == nil) != (session == nil) || s.Registration.ClientID != "registered" {
				t.Fatal("lost migrated account")
			}
			return false, nil
		}
		for attempt := range 2 {
			if err := v.transaction(context.Background(), check); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(legacy); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("legacy account survived migration")
			}
			// Restore the interrupted-cleanup state before running migration again.
			if attempt == 1 {
				break
			}
			if err := os.WriteFile(legacy, data, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestUninstallWaitsForActiveHost(t *testing.T) {
	dir := t.TempDir()
	active, err := hostLock(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if f, err := hostLock(dir, true); err == nil {
		f.Close()
		t.Fatal("removed an account while in use")
	}
	active.Close()
	removal, err := hostLock(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	removal.Close()
	if f, err := hostLock(dir, false); err == nil {
		f.Close()
		t.Fatal("opened account during uninstall")
	}
}

func TestFailedMigrationPreservesLegacyCredential(t *testing.T) {
	v := vault{t.TempDir()}
	t.Cleanup(func() { records.remove(v.directory) })
	legacy := filepath.Join(v.directory, "session.json")
	data, err := json.Marshal(state{Session: &session{Refresh: "old-refresh"}})
	if err != nil {
		t.Fatal(err)
	}
	partial := state{LegacyDigest: fmt.Sprintf("%x", sha256.Sum256(data))}
	if err := v.save(partial); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, data, 0600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		err := v.transaction(context.Background(), func(*state) (bool, error) { t.Fatal("used an unverified account"); return false, nil })
		if err == nil {
			t.Fatal("expected migration failure")
		}
		if saved, err := os.ReadFile(legacy); err != nil || !bytes.Equal(saved, data) {
			t.Fatal("lost previous credential", err)
		}
	}
}

func TestConcurrentHostsShareRotatedCredential(t *testing.T) {
	ctx := context.Background()
	v := vault{t.TempDir()}
	defer records.remove(v.directory)
	err := v.transaction(ctx, func(s *state) (bool, error) {
		s.Registration.ClientID = "client"
		s.Session = &session{Refresh: "first", Scope: planScope}
		s.Generation = 3
		return true, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.FormValue("refresh_token") != "first" {
			t.Error("unexpected refresh token")
		}
		io.WriteString(w, `{"access_token":"next","refresh_token":"rotated","token_type":"Bearer","expires_in":3600}`)
	}))
	defer server.Close()
	p := provider{server.URL, resource, server.Client(), v}
	results := make(chan error, 2)
	for range 2 {
		go func() {
			access, err := p.access(ctx, 3, true)
			if err == nil && access != "next" {
				err = errors.New("received old token")
			}
			results <- err
		}()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if count.Load() != 1 {
		t.Fatal("refreshed the same session more than once")
	}
	if err := v.transaction(ctx, func(s *state) (bool, error) {
		if s.Session.Refresh != "rotated" || s.Generation != 3 {
			t.Fatal("lost rotated credential or invalidated active session")
		}
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
}
