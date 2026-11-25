package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCFNetworkProxyRouting(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "mac-proxy")
	if out, err := exec.Command("xcrun", "clang", "testdata/mac_proxy.m", "proxy_darwin.c", "-framework", "Foundation", "-framework", "CFNetwork", "-framework", "CoreFoundation", "-o", bin).CombinedOutput(); err != nil {
		t.Fatalf("build native fixture: %v\n%s", err, out)
	}
	releaseSlowPAC := make(chan struct{})
	pac := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/routes.pac":
			w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
			w.Write([]byte(`function FindProxyForURL(url, host) {
				return host === "api.example.test" ? "PROXY localhost:8001; DIRECT" : "DIRECT";
			}`))
		case "/slow.pac":
			<-releaseSlowPAC
		default:
			http.NotFound(w, r)
		}
	}))
	defer pac.Close()
	defer close(releaseSlowPAC)
	manual := map[string]any{"HTTPSEnable": 1, "HTTPSProxy": "localhost", "HTTPSPort": 8000, "ExceptionsList": []string{"*.bypass.test"}}
	auto := func(path string) map[string]any {
		return map[string]any{"ProxyAutoConfigEnable": 1, "ProxyAutoConfigURLString": pac.URL + path}
	}
	for _, tt := range []struct {
		name       string
		settings   map[string]any
		host, want string
		fail       bool
		deadlineMS string
	}{
		{"no proxy", map[string]any{}, "api.example.test", "DIRECT", false, "8000"},
		{"HTTPS destination through HTTP CONNECT", manual, "api.example.test", "http://localhost:8000", false, "8000"},
		{"bypass", manual, "api.bypass.test", "DIRECT", false, "8000"},
		{"SOCKS", map[string]any{"SOCKSEnable": 1, "SOCKSProxy": "localhost", "SOCKSPort": 1080}, "api.example.test", "socks5://localhost:1080", false, "8000"},
		{"PAC proxy", auto("/routes.pac"), "api.example.test", "http://localhost:8001", false, "8000"},
		{"PAC direct", auto("/routes.pac"), "elsewhere.example.test", "DIRECT", false, "8000"},
		{"unavailable PAC", auto("/missing.pac"), "api.example.test", "could not be loaded or evaluated", true, "8000"},
		{"cancelled PAC", auto("/slow.pac"), "api.example.test", "cancelled or timed out", true, "200"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.settings)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			out, err := exec.CommandContext(ctx, bin, string(data), "https://"+tt.host+"/models", tt.deadlineMS).CombinedOutput()
			if (err != nil) != tt.fail || !strings.Contains(string(out), tt.want) {
				t.Fatalf("native resolution = %q, %v", out, err)
			}
		})
	}
}
