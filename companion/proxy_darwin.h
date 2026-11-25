#include <CFNetwork/CFNetwork.h>
#include <stdint.h>

// A successful DIRECT route has a NULL scheme. The caller frees host when present.
typedef struct {
    const char *error;
    const char *scheme;
    char *host;
    int port;
} MarginProxyRoute;

int marginProxyCancelled(uintptr_t context);
MarginProxyRoute marginResolveProxy(CFDictionaryRef settings, const char *target, uintptr_t context);
