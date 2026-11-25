#include "proxy_darwin.h"
#include <stdlib.h>
#include <string.h>

static MarginProxyRoute firstRoute(CFArrayRef list) {
    if (!list || CFArrayGetCount(list) == 0)
        return (MarginProxyRoute){.error = "CFNetwork returned no route."};
    CFDictionaryRef entry = CFArrayGetValueAtIndex(list, 0);
    CFStringRef type = CFDictionaryGetValue(entry, kCFProxyTypeKey);
    if (!type) return (MarginProxyRoute){.error = "CFNetwork returned an incomplete route."};
    if (CFEqual(type, kCFProxyTypeNone)) return (MarginProxyRoute){0};

    MarginProxyRoute route = {0};
    if (CFEqual(type, kCFProxyTypeHTTP) || CFEqual(type, kCFProxyTypeHTTPS)) {
        // CFNetwork's HTTPS type is the HTTP CONNECT proxy for an HTTPS destination.
        route.scheme = "http";
    } else if (CFEqual(type, kCFProxyTypeSOCKS)) {
        CFStringRef version = CFDictionaryGetValue(entry, kCFStreamPropertySOCKSVersion);
        if (version && !CFEqual(version, kCFStreamSocketSOCKSVersion5))
            return (MarginProxyRoute){.error = "The selected SOCKS proxy requires an unsupported version."};
        route.scheme = "socks5";
    } else {
        return (MarginProxyRoute){.error = "The selected macOS proxy protocol is unsupported."};
    }
    CFStringRef host = CFDictionaryGetValue(entry, kCFProxyHostNameKey);
    CFNumberRef port = CFDictionaryGetValue(entry, kCFProxyPortNumberKey);
    if (!host || CFStringGetLength(host) == 0 || !port || !CFNumberGetValue(port, kCFNumberIntType, &route.port)
        || route.port < 1 || route.port > 65535)
        return (MarginProxyRoute){.error = "CFNetwork returned an incomplete proxy address."};
    CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(host), kCFStringEncodingUTF8) + 1;
    route.host = malloc(size);
    if (!route.host || !CFStringGetCString(host, route.host, size, kCFStringEncodingUTF8)) {
        free(route.host);
        return (MarginProxyRoute){.error = "Could not read the macOS proxy address."};
    }
    return route;
}

typedef struct {
    Boolean done;
    MarginProxyRoute route;
} PACResult;

static void pacCompleted(void *info, CFArrayRef list, CFErrorRef error) {
    PACResult *result = info;
    result->route = error ? (MarginProxyRoute){.error = "The macOS PAC script could not be loaded or evaluated."}
                          : firstRoute(list);
    result->done = true;
}

static MarginProxyRoute resolveList(CFArrayRef list, CFURLRef target, uintptr_t context) {
    if (!list || CFArrayGetCount(list) == 0) return firstRoute(list);
    CFDictionaryRef entry = CFArrayGetValueAtIndex(list, 0);
    CFStringRef type = CFDictionaryGetValue(entry, kCFProxyTypeKey);
    if (!type || (!CFEqual(type, kCFProxyTypeAutoConfigurationURL) &&
                  !CFEqual(type, kCFProxyTypeAutoConfigurationJavaScript))) return firstRoute(list);

    PACResult result = {0};
    CFStreamClientContext client = {0, &result, NULL, NULL, NULL};
    CFRunLoopSourceRef source = NULL;
    if (CFEqual(type, kCFProxyTypeAutoConfigurationURL)) {
        CFURLRef url = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationURLKey);
        if (url) source = CFNetworkExecuteProxyAutoConfigurationURL(url, target, pacCompleted, &client);
    } else {
        CFStringRef script = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationJavaScriptKey);
        if (script) source = CFNetworkExecuteProxyAutoConfigurationScript(script, target, pacCompleted, &client);
    }
    if (!source) return (MarginProxyRoute){.error = "Could not start macOS PAC resolution."};

    // Only this invocation's thread runs this source. Invalidate it before releasing the callback context.
    CFRunLoopRef loop = CFRunLoopGetCurrent();
    CFStringRef mode = CFSTR("MarginProxyResolution");
    CFRunLoopAddSource(loop, source, mode);
    while (!result.done && !marginProxyCancelled(context))
        CFRunLoopRunInMode(mode, 0.1, true);
    CFRunLoopSourceInvalidate(source);
    CFRunLoopRemoveSource(loop, source, mode);
    CFRelease(source);
    if (!result.done) return (MarginProxyRoute){.error = "macOS PAC resolution was cancelled or timed out."};
    return result.route;
}

MarginProxyRoute marginResolveProxy(CFDictionaryRef settings, const char *target, uintptr_t context) {
    if (!settings) return (MarginProxyRoute){.error = "Could not read macOS network proxy settings."};
    CFURLRef url = CFURLCreateWithBytes(NULL, (const UInt8 *)target, strlen(target), kCFStringEncodingUTF8, NULL);
    if (!url) return (MarginProxyRoute){.error = "Could not resolve a proxy for this URL."};
    CFArrayRef list = CFNetworkCopyProxiesForURL(url, settings);
    MarginProxyRoute route = resolveList(list, url, context);
    if (list) CFRelease(list);
    CFRelease(url);
    return route;
}
