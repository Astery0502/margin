package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winHTTP        = windows.NewLazySystemDLL("winhttp.dll")
	openSession    = winHTTP.NewProc("WinHttpOpen")
	closeHandle    = winHTTP.NewProc("WinHttpCloseHandle")
	userConfig     = winHTTP.NewProc("WinHttpGetIEProxyConfigForCurrentUser")
	createResolver = winHTTP.NewProc("WinHttpCreateProxyResolver")
	setCallback    = winHTTP.NewProc("WinHttpSetStatusCallback")
	proxyForURL    = winHTTP.NewProc("WinHttpGetProxyForUrlEx")
	getResult      = winHTTP.NewProc("WinHttpGetProxyResult")
	freeResult     = winHTTP.NewProc("WinHttpFreeProxyResult")
	globalFree     = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalFree")
)

type ieProxyConfig struct {
	autoDetect         uint32
	pac, proxy, bypass *uint16
}
type autoProxyOptions struct {
	flags, detectFlags       uint32
	pac                      *uint16
	reserved                 uintptr
	reservedFlags, autoLogon uint32
}
type proxyEntry struct {
	isProxy, bypass, scheme uint32
	host                    *uint16
	port                    uint16
}
type proxyResult struct {
	count   uint32
	entries *proxyEntry
}

const (
	autoDetect             = 0x1
	configURL              = 0x2
	allowStatic            = 0x200
	allowConnectionManager = 0x400
	requestError           = 0x00200000
	proxyComplete          = 0x01000000
)

func systemProxy(ctx context.Context, target *url.URL) (*url.URL, error) {
	var config ieProxyConfig
	ok, _, err := userConfig.Call(uintptr(unsafe.Pointer(&config)))
	if ok == 0 {
		if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
			return nil, nil
		}
		return nil, err
	}
	for _, ptr := range []*uint16{config.pac, config.proxy, config.bypass} {
		if ptr != nil {
			defer globalFree.Call(uintptr(unsafe.Pointer(ptr)))
		}
	}
	// An explicitly configured PAC must resolve successfully, including when it says DIRECT.
	if config.pac != nil {
		return resolveProxy(ctx, target, autoProxyOptions{flags: configURL, pac: config.pac})
	}
	if config.autoDetect != 0 {
		proxy, err := resolveProxy(ctx, target, autoProxyOptions{flags: autoDetect, detectFlags: 3}) // DHCP and DNS-A
		// Only the absence of a discoverable configuration permits using manual settings.
		if !errors.Is(err, windows.Errno(12180)) {
			return proxy, err
		}
	}
	if config.proxy == nil {
		return nil, nil
	}
	// WinHTTP applies the active connection's manual proxy and bypass list for this URL.
	return resolveProxy(ctx, target, autoProxyOptions{flags: allowStatic | allowConnectionManager})
}

var (
	nextLookup         atomic.Uintptr
	lookups            sync.Map // An integer token remains safe if WinHTTP calls back after cancellation.
	completionCallback = windows.NewCallback(proxyCallback)
)

type asyncProxyResult struct {
	operation uintptr
	code      uint32
}

func proxyCallback(_ uintptr, id uintptr, status uint32, info *asyncProxyResult, _ uint32) uintptr {
	ch, ok := lookups.LoadAndDelete(id)
	if ok {
		var err error
		if status != proxyComplete {
			err = errors.New("WinHTTP proxy lookup failed.")
			if info != nil && info.code != 0 {
				err = windows.Errno(info.code)
			}
		}
		ch.(chan error) <- err
	}
	return 0
}

func resolveProxy(ctx context.Context, target *url.URL, options autoProxyOptions) (*url.URL, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	wide, err := windows.UTF16PtrFromString(target.String())
	if err != nil {
		return nil, err
	}
	const noProxy, async = 1, 0x10000000 // Session is used only for resolution.
	session, _, err := openSession.Call(0, noProxy, 0, 0, async)
	if session == 0 {
		return nil, err
	}
	defer closeHandle.Call(session)
	old, _, err := setCallback.Call(session, completionCallback, requestError|proxyComplete, 0)
	if old == ^uintptr(0) {
		return nil, err
	}

	var resolver uintptr
	code, _, _ := createResolver.Call(session, uintptr(unsafe.Pointer(&resolver)))
	if code != 0 {
		return nil, windows.Errno(code)
	}
	defer closeHandle.Call(resolver)
	id := nextLookup.Add(1)
	done := make(chan error, 1)
	lookups.Store(id, done)
	defer lookups.Delete(id)
	code, _, _ = proxyForURL.Call(resolver, uintptr(unsafe.Pointer(wide)), uintptr(unsafe.Pointer(&options)), id)
	if code != uintptr(windows.ERROR_IO_PENDING) {
		return nil, fmt.Errorf("WinHTTP could not start proxy resolution: %w", windows.Errno(code))
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case err := <-done:
		if err != nil {
			return nil, err
		}
	}

	var result proxyResult
	code, _, _ = getResult.Call(resolver, uintptr(unsafe.Pointer(&result)))
	if code != 0 {
		return nil, windows.Errno(code)
	}
	defer freeResult.Call(uintptr(unsafe.Pointer(&result)))
	if result.count == 0 || result.entries == nil {
		return nil, errors.New("WinHTTP returned no route.")
	}
	// Honor the preferred route. Never replay a token exchange or model request on a fallback route.
	first := result.entries
	if first.isProxy == 0 {
		return nil, nil
	}
	var scheme string
	switch first.scheme {
	case 1:
		scheme = "http"
	case 2:
		scheme = "https"
	default:
		return nil, errors.New("The selected Windows proxy protocol is unsupported. Use an HTTP or HTTPS proxy.")
	}
	host := windows.UTF16PtrToString(first.host)
	if host == "" || first.port == 0 {
		return nil, errors.New("WinHTTP returned an incomplete proxy address.")
	}
	return &url.URL{Scheme: scheme, Host: net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(int(first.port)))}, nil
}
