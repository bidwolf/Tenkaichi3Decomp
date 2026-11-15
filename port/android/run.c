/* Starts the Android build of the game from a shell (adb): `bt3_android` next to `libbt3.so`.

   The game's addresses are offsets in a 4 GB window at a fixed address (port/src/port_addr.h, PORT_WINDOW; the why is
   in docs/port/android_plan.md). The game is one image linked for window + 0x20000000, with no relocations for its
   4-byte pointers, so it only works there. This program reserves the whole window before anything else can sit in
   it, has Android's loader place the image at its address inside (android_dlopen_ext with a reserved address: the
   loader then maps the image there and nowhere else), and calls the game's entry (__wrap_main, port/src/plat_mem.c).
   The app will do the same from its native library; this is the form for tests without a screen. */
#define _GNU_SOURCE
#include <android/dlext.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#define WINDOW 0x1000000000ull
#define PROGRAM 0x20000000ull
#define PROGRAM_ROOM 0x10000000ull /* (the image is far smaller: 256 MB of the window are its own) */

/* SDL's functions that ask Android's Java side, which a program started from a shell does not have (they crash
   there). The game finds these here first: this program's exported symbols come before the libraries'. */
static char sBase[1024];
const char *SDL_GetBasePath(void) {
    return sBase;
}

int main(int argc, char **argv) {
    char path[1024];
    long n = (long)readlink("/proc/self/exe", path, sizeof(path) - 16);
    android_dlextinfo info;
    void *window, *image;
    int (*entry)(int, char **);

    if (n <= 0) {
        fprintf(stderr, "bt3: cannot tell where this program is\n");
        return 2;
    }
    path[n] = 0;
    strcpy(sBase, path);
    if (strrchr(sBase, '/') != NULL) {
        strrchr(sBase, '/')[1] = 0;
    }
    strcpy(strrchr(path, '/') != NULL ? strrchr(path, '/') + 1 : path, "libbt3.so");
    window = mmap((void *)WINDOW, 0x100000000ull, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE | MAP_FIXED_NOREPLACE, -1, 0);
    if (window != (void *)WINDOW) {
        fprintf(stderr, "bt3: the game's 4 GB of addresses at %#llx are not free here (%s)\n", WINDOW, strerror(errno));
        return 2;
    }
    memset(&info, 0, sizeof(info));
    info.flags = ANDROID_DLEXT_RESERVED_ADDRESS;
    info.reserved_addr = (void *)(WINDOW + PROGRAM);
    info.reserved_size = PROGRAM_ROOM;
    image = android_dlopen_ext(path, RTLD_NOW | RTLD_GLOBAL, &info);
    if (image == NULL) {
        fprintf(stderr, "bt3: cannot load the game (%s)\n", dlerror());
        return 2;
    }
    entry = (int (*)(int, char **))dlsym(image, "__wrap_main");
    if (entry == NULL || (uintptr_t)entry < WINDOW + PROGRAM || (uintptr_t)entry >= WINDOW + PROGRAM + PROGRAM_ROOM) {
        fprintf(stderr, "bt3: the game was not loaded at the address it needs (entry at %p)\n", (void *)entry);
        return 2;
    }
    return entry(argc, argv);
}
