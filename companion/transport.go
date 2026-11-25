package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Resolve the route once per request, before net/http selects a pooled connection.
type systemProxyTransport struct {
	resolve func(context.Context, *url.URL) (*url.URL, error)
	http    *http.Transport
}

type selectedProxyKey struct{}
type proxyFailure struct{ message string }

func (e *proxyFailure) Error() string { return e.message }

func newSystemProxyTransport(resolve func(context.Context, *url.URL) (*url.URL, error)) *systemProxyTransport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = func(r *http.Request) (*url.URL, error) {
		proxy, _ := r.Context().Value(selectedProxyKey{}).(*url.URL)
		return proxy, nil
	}
	t.OnProxyConnectResponse = func(_ context.Context, _ *url.URL, _ *http.Request, res *http.Response) error {
		if res.StatusCode != http.StatusOK {
			return &proxyFailure{fmt.Sprintf("The system proxy refused the connection (HTTP %d).", res.StatusCode)}
		}
		return nil
	}
	return &systemProxyTransport{resolve, t}
}

func (t *systemProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := strings.TrimSuffix(req.URL.Hostname(), ".")
	if strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback() {
		return t.http.RoundTrip(req)
	}
	lookup, cancel := context.WithTimeout(req.Context(), 15*time.Second)
	proxy, err := t.resolve(lookup, req.URL)
	cancel()
	if err != nil {
		if req.Body != nil {
			req.Body.Close()
		}
		return nil, &proxyFailure{"Could not resolve the system proxy for this request. " + err.Error()}
	}
	if proxy == nil {
		return t.http.RoundTrip(req)
	}
	res, err := t.http.RoundTrip(req.WithContext(context.WithValue(req.Context(), selectedProxyKey{}, proxy)))
	var failure *proxyFailure
	if err != nil && !errors.As(err, &failure) && !errors.Is(req.Context().Err(), context.Canceled) {
		return nil, &proxyFailure{"The request through the system proxy failed. Check the proxy connection and settings."}
	}
	return res, err
}

// Only expose diagnostics that cannot contain URLs, OAuth parameters or credentials.
func connectionError(err error, fallback string) error {
	var failure *proxyFailure
	if errors.As(err, &failure) {
		return failure
	}
	return errors.New(fallback)
}
