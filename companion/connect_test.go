package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Only the test executable redirects provider traffic to the isolated fixture.
type localTransport struct{ target *url.URL }

func (t localTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	req := r.Clone(r.Context())
	req.URL.Scheme = t.target.Scheme
	req.URL.Host = t.target.Host
	return http.DefaultTransport.RoundTrip(req)
}
func TestMain(m *testing.M) {
	binary, _ := os.Executable()
	if len(os.Args) == 3 && os.Args[1] == "--install-fixture" {
		root := os.Args[2]
		if err := install(root, binary, []string{filepath.Join(root, "browser")}); err != nil {
			panic(err)
		}
		return
	}
	if len(os.Args) > 1 && strings.HasPrefix(os.Args[1], "chrome-extension://") {
		dir := filepath.Dir(binary)
		data, err := os.ReadFile(filepath.Join(dir, "fixture-url"))
		if err != nil {
			panic(err)
		}
		target, err := url.Parse(string(data))
		if err != nil || target.Hostname() != "127.0.0.1" {
			panic("invalid local fixture")
		}
		runNative(provider{issuer, resource, &http.Client{Transport: localTransport{target}}, vault{dir}})
		return
	}
	os.Exit(m.Run())
}
func TestRefreshFailurePreservesRegistration(t *testing.T) {
	v := vault{t.TempDir()}
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
	f, err := os.Stat(filepath.Join(v.directory, "session.json"))
	if err != nil || f.Mode().Perm() != 0600 {
		t.Fatal("credentials must be readable only by their owner")
	}
}
