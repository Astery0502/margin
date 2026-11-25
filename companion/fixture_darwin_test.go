package main

import (
	"net/http"
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
		if err := install(root, binary, "dev.margin.test_connect", []string{filepath.Join(root, "browser")}); err != nil {
			panic(err)
		}
		return
	}
	if len(os.Args) == 3 && os.Args[1] == "--clean-fixture" {
		dir := filepath.Join(os.Args[2], "Margin", "Connect")
		for _, d := range []string{dir, filepath.Join(dir, "DeepSeek")} {
			records.remove(d)
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

func TestResumeInterruptedHostUpgrade(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "Margin", "Connect")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "MarginConnect")
	if err := os.WriteFile(binary, []byte("old"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(binary, filepath.Join(dir, "previous-host")); err != nil {
		t.Fatal(err)
	}
	if err := readyForAccounts(dir); err == nil {
		t.Fatal("accepted a half-installed host")
	}
	next := filepath.Join(root, "new")
	if err := os.WriteFile(next, []byte("new"), 0700); err != nil {
		t.Fatal(err)
	}
	original := origins
	origins = "chrome-extension://fixture/"
	t.Cleanup(func() { origins = original })
	if err := install(root, next, "dev.margin.test_connect", nil); err != nil {
		t.Fatal(err)
	}
	if err := readyForAccounts(dir); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(binary); err != nil || string(data) != "new" {
		t.Fatal("upgrade did not complete", err)
	}
}
