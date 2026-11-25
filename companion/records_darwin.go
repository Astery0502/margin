package main

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#cgo CFLAGS: -Wno-deprecated-declarations
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>

// Restrict access to the default user keychain and suppress interaction in a browser-launched host.
static OSStatus accountItem(const char *account, void *input, UInt32 inputSize, void **output, UInt32 *size, int remove) {
    const char *service = "dev.margin.connect";
    SecKeychainRef keychain = NULL;
    SecKeychainItemRef item = NULL;
    OSStatus result = SecKeychainSetUserInteractionAllowed(false);
    if (result == errSecSuccess) result = SecKeychainCopyDefault(&keychain);
    if (result != errSecSuccess) return result;
    result = SecKeychainFindGenericPassword(keychain, strlen(service), service, strlen(account), account, size, output, &item);
    if (input != NULL) {
        if (result == errSecItemNotFound)
            result = SecKeychainAddGenericPassword(keychain, strlen(service), service, strlen(account), account, inputSize, input, NULL);
        else if (result == errSecSuccess)
            result = SecKeychainItemModifyAttributesAndData(item, NULL, inputSize, input);
    } else if (remove && result == errSecSuccess) result = SecKeychainItemDelete(item);
    if (item) CFRelease(item);
    CFRelease(keychain);
    return result;
}
static void freePassword(void *data) { SecKeychainItemFreeContent(NULL, data); }
*/
import "C"
import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func keychainError(code C.OSStatus) error {
	switch code {
	case C.errSecSuccess:
		return nil
	case C.errSecItemNotFound:
		return os.ErrNotExist
	case C.errSecInteractionNotAllowed, C.errSecAuthFailed:
		return errors.New("Unlock the login keychain or allow the signed Margin Connect to access its saved account, then try again.")
	default:
		return fmt.Errorf("Could not access the Margin Connect keychain item (status %d).", code)
	}
}
func (systemRecords) read(directory string) ([]byte, error) {
	name := C.CString(directory)
	defer C.free(unsafe.Pointer(name))
	var data unsafe.Pointer
	var size C.UInt32
	if err := keychainError(C.accountItem(name, nil, 0, &data, &size, 0)); err != nil {
		return nil, err
	}
	defer C.freePassword(data)
	return C.GoBytes(data, C.int(size)), nil
}
func (systemRecords) write(directory string, data []byte) error {
	name := C.CString(directory)
	defer C.free(unsafe.Pointer(name))
	return keychainError(C.accountItem(name, unsafe.Pointer(&data[0]), C.UInt32(len(data)), nil, nil, 0))
}
func (systemRecords) remove(directory string) error {
	name := C.CString(directory)
	defer C.free(unsafe.Pointer(name))
	return keychainError(C.accountItem(name, nil, 0, nil, nil, 1))
}
func tryLock(f *os.File, exclusive bool) (bool, error) {
	mode := syscall.LOCK_SH
	if exclusive {
		mode = syscall.LOCK_EX
	}
	err := syscall.Flock(int(f.Fd()), mode|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return true, nil
	}
	return false, err
}
