#import <Foundation/Foundation.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv) {
    @autoreleasepool {
        NSURL *host = [NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:@"Contents/Helpers/MarginConnect"];
        execv(host.fileSystemRepresentation, argv);
        perror("Could not launch Margin Connect");
        return 1;
    }
}
