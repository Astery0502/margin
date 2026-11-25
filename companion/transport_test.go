package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOAuthProxyRouting(t *testing.T) {
	var connects atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect || r.Host != "issuer.invalid:443" {
			t.Errorf("unexpected proxy request: %s %s", r.Method, r.Host)
		}
		connects.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer proxy.Close()
	address, _ := url.Parse(proxy.URL)
	resolveErr := false
	transport := newSystemProxyTransport(func(_ context.Context, target *url.URL) (*url.URL, error) {
		if target.String() != "https://issuer.invalid/api/accounts/oauth/token" {
			t.Fatalf("unexpected proxy lookup for %s", target)
		}
		if resolveErr {
			return nil, errors.New("PAC lookup failed")
		}
		return address, nil
	})
	dial := transport.http.DialContext
	transport.http.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr == "issuer.invalid:443" {
			t.Error("attempted a direct connection to the issuer")
			return nil, errors.New("unexpected direct connection")
		}
		return dial(ctx, network, addr)
	}
	defer transport.http.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	p := provider{issuer: "https://issuer.invalid", client: client}
	// Both grants must use the selected proxy. A denied tunnel is distinct from an origin 403.
	for _, grant := range []string{"authorization_code", "refresh_token"} {
		_, err := p.token(context.Background(), url.Values{"grant_type": {grant}})
		var failure *proxyFailure
		if !errors.As(err, &failure) || !strings.Contains(err.Error(), "proxy refused the connection (HTTP 403)") {
			t.Fatalf("%s: %v", grant, err)
		}
	}
	proxy.Close()
	_, err := p.token(context.Background(), url.Values{})
	if err == nil || !strings.Contains(err.Error(), "through the system proxy failed") {
		t.Fatalf("unavailable proxy: %v", err)
	}
	resolveErr = true
	_, err = p.token(context.Background(), url.Values{})
	if err == nil || !strings.Contains(err.Error(), "PAC lookup failed") || connects.Load() != 2 {
		t.Fatalf("resolution failure: %v, %d connections", err, connects.Load())
	}

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "redacted-provider-content", http.StatusForbidden)
	}))
	defer origin.Close()
	p.issuer = origin.URL // The loopback callback network must remain reachable with a broken resolver.
	_, err = p.token(context.Background(), url.Values{})
	var upstream *providerHTTPError
	if !errors.As(err, &upstream) || upstream.status != 403 || strings.Contains(err.Error(), "redacted") {
		t.Fatalf("origin HTTP status: %v", err)
	}
}
