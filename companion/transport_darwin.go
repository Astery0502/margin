package main

/*
#cgo LDFLAGS: -framework CFNetwork -framework CoreFoundation
#include "proxy_darwin.h"
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"errors"
	"net"
	"net/url"
	"runtime/cgo"
	"strconv"
	"strings"
	"unsafe"
)

//export marginProxyCancelled
func marginProxyCancelled(id C.uintptr_t) C.int {
	if cgo.Handle(id).Value().(context.Context).Err() != nil {
		return 1
	}
	return 0
}

func systemProxy(ctx context.Context, target *url.URL) (*url.URL, error) {
	handle := cgo.NewHandle(ctx)
	defer handle.Delete()
	address := C.CString(target.String())
	defer C.free(unsafe.Pointer(address))
	settings := C.CFNetworkCopySystemProxySettings()
	if settings != 0 {
		defer C.CFRelease(C.CFTypeRef(settings))
	}
	route := C.marginResolveProxy(settings, address, C.uintptr_t(handle))
	if route.host != nil {
		defer C.free(unsafe.Pointer(route.host))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if route.error != nil {
		return nil, errors.New(C.GoString(route.error))
	}
	if route.scheme == nil {
		return nil, nil
	}
	host := strings.Trim(C.GoString(route.host), "[]")
	return &url.URL{Scheme: C.GoString(route.scheme), Host: net.JoinHostPort(host, strconv.Itoa(int(route.port)))}, nil
}
