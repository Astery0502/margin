#import <Foundation/Foundation.h>
#include "../proxy_darwin.h"

// Use isolated CFNetwork settings and a steady deadline without changing any network service.
int marginProxyCancelled(uintptr_t milliseconds) {
    return NSProcessInfo.processInfo.systemUptime * 1000 >= milliseconds;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 4) return 2;
        NSData *json = [NSData dataWithBytes:argv[1] length:strlen(argv[1])];
        NSDictionary *settings = [NSJSONSerialization JSONObjectWithData:json options:0 error:NULL];
        if (![settings isKindOfClass:NSDictionary.class]) return 2;
        uintptr_t deadline = NSProcessInfo.processInfo.systemUptime * 1000 + atoi(argv[3]);
        MarginProxyRoute route = marginResolveProxy((__bridge CFDictionaryRef)settings, argv[2], deadline);
        if (route.error) { puts(route.error); return 1; }
        if (route.scheme) printf("%s://%s:%d\n", route.scheme, route.host, route.port);
        else puts("DIRECT");
        free(route.host);
        return 0;
    }
}
