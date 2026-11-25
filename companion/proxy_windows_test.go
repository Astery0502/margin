package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// Exercise WinHTTP's actual PAC engine without changing the test user's proxy settings.
func TestWinHTTPPerURLPAC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxy.pac" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
		fmt.Fprint(w, `function FindProxyForURL(url, host) {
			if (host === "proxy-test.invalid") return "PROXY 127.0.0.1:8123; DIRECT";
			return "DIRECT";
		}`)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pac, _ := windows.UTF16PtrFromString(server.URL + "/proxy.pac")
	for _, test := range []struct{ target, proxy string }{
		{"https://proxy-test.invalid/models", "http://127.0.0.1:8123"},
		{"https://bypass-test.invalid/models", ""},
	} {
		target, _ := url.Parse(test.target)
		got, err := resolveProxy(ctx, target, autoProxyOptions{flags: configURL, pac: pac})
		if err != nil {
			t.Fatal(err)
		}
		if got == nil && test.proxy != "" || got != nil && got.String() != test.proxy {
			t.Fatalf("%s resolved to %v, want %q", target, got, test.proxy)
		}
	}
	missing, _ := windows.UTF16PtrFromString(server.URL + "/missing.pac")
	target, _ := url.Parse("https://proxy-test.invalid/models")
	if _, err := resolveProxy(ctx, target, autoProxyOptions{flags: configURL, pac: missing}); err == nil {
		t.Fatal("failed PAC download allowed a connection")
	}
}
