/* The app's native side: libmain.so, whose SDL_main SDL's activity calls on the game's thread.

   Does what port/android/run.c does for a shell (reserve the game's 4 GB window, have the game's image loaded at its
   address in it, call its entry), after pointing the game at the app's files folder on the shared storage
   (Android/data/com.rinhaonline.bt3/files): the current directory (gamedata/, saves/, settings), BT3_EXE (the lists
   and files the game looks for next to its program, port/src/port_exe.h), and a log of what the game prints
   (bt3_log.txt). Without the game data there (it comes from the player's own disc, made on a computer), it says so
   in a box and stops: the game itself would wait for its files for ever. */
#define _GNU_SOURCE
#include <SDL3/SDL.h>
#include <android/dlext.h>
#include <android/log.h>
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define WINDOW 0x1000000000ull
#define PROGRAM 0x20000000ull
#define PROGRAM_ROOM 0x10000000ull
#define STACK_BASE 0x02000000ull /* the game thread's stack in the window (port/src/plat_mem.c: STACK_BASE, STACK_SIZE) */
#define STACK_SIZE 0x01000000ull

/* The game's thread. Its stack IS the window's stack region (the game keeps addresses of its locals in 4 bytes), given
   to the thread when it is made, so that Android's Java runtime knows it as this thread's stack: the runtime takes
   a stack pointer outside the stack a thread was made with for a stack overflow, and SDL calls Java (the window's
   surface, among others). Switching stacks inside a thread, as the other systems' builds do, fails for that reason. */
static struct { int (*entry)(int, char **); int argc; char **argv; int result; } sGame;
static void *game_thread(void *unused) {
    (void)unused;
    sGame.result = sGame.entry(sGame.argc, sGame.argv);
    return NULL;
}

static int stop(const char *text) {
    __android_log_print(ANDROID_LOG_ERROR, "bt3", "%s", text);
    fprintf(stderr, "bt3: %s\n", text);
    SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Rinha Online", text, NULL);
    return 2;
}

__attribute__((visibility("default"))) int SDL_main(int argc, char **argv) {
    static char text[2048], path[1024], exe[1024];
    const char *files = SDL_GetAndroidExternalStoragePath();
    android_dlextinfo info;
    struct stat st;
    Dl_info self;
    void *window, *image;
    int (*entry)(int, char **);

    /* landscape only: SDL lets a resizable window (the game's is one) turn with the phone otherwise */
    SDL_SetHint(SDL_HINT_ORIENTATIONS, "LandscapeLeft LandscapeRight");
    if (files == NULL || chdir(files) != 0) {
        return stop("The app's files folder on the shared storage cannot be used.");
    }
    if (freopen("bt3_log.txt", "w", stderr) != NULL) {
        setvbuf(stderr, NULL, _IOLBF, 0);
        dup2(fileno(stderr), 1);
    }
    snprintf(exe, sizeof(exe), "%s/bt3_android", files);
    setenv("BT3_EXE", exe, 1);
    if (getenv("BT3_GS") == NULL) {
        setenv("BT3_GS", "gpu", 1);
    }
    if (getenv("BT3_FULLSCREEN") == NULL) { /* (no status and navigation bars over the picture) */
        setenv("BT3_FULLSCREEN", "1", 1);
    }
    if (stat("gamedata/pzs3us1", &st) != 0 || stat("gamedata/disc", &st) != 0) {
        snprintf(text, sizeof(text),
                 "The game data is not on this phone yet.\n\n"
                 "It is made on a computer from your own disc of the game (the folder \"gamedata\" of the PC version) "
                 "and copied to this phone, into:\n\n%s/gamedata", files);
        return stop(text);
    }
    window = mmap((void *)WINDOW, 0x100000000ull, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE | MAP_FIXED_NOREPLACE, -1, 0);
    if (window != (void *)WINDOW) {
        snprintf(text, sizeof(text), "The game's 4 GB of addresses at %#llx are not free in this app (%s).", WINDOW, strerror(errno));
        return stop(text);
    }
    if (dladdr((void *)SDL_main, &self) == 0 || self.dli_fname == NULL || strrchr(self.dli_fname, '/') == NULL) {
        return stop("Cannot tell where the app's libraries are.");
    }
    snprintf(path, sizeof(path), "%.*s/libbt3.so", (int)(strrchr(self.dli_fname, '/') - self.dli_fname), self.dli_fname);
    memset(&info, 0, sizeof(info));
    info.flags = ANDROID_DLEXT_RESERVED_ADDRESS;
    info.reserved_addr = (void *)(WINDOW + PROGRAM);
    info.reserved_size = PROGRAM_ROOM;
    image = android_dlopen_ext(path, RTLD_NOW | RTLD_GLOBAL, &info);
    if (image == NULL) {
        snprintf(text, sizeof(text), "Cannot load the game (%s).", dlerror());
        return stop(text);
    }
    entry = (int (*)(int, char **))dlsym(image, "__wrap_main");
    if (entry == NULL || (uintptr_t)entry < WINDOW + PROGRAM || (uintptr_t)entry >= WINDOW + PROGRAM + PROGRAM_ROOM) {
        return stop("The game was not loaded at the address it needs.");
    }
    {
        pthread_attr_t attr;
        pthread_t thread;
        int err;

        sGame.entry = entry;
        sGame.argc = argc;
        sGame.argv = argv;
        pthread_attr_init(&attr);
        err = pthread_attr_setstack(&attr, (void *)(WINDOW + STACK_BASE), STACK_SIZE); /* (mapped when the image was loaded) */
        if (err == 0) {
            err = pthread_create(&thread, &attr, game_thread, NULL);
        }
        if (err != 0) {
            snprintf(text, sizeof(text), "Cannot start the game's thread (%s).", strerror(err));
            return stop(text);
        }
        pthread_join(thread, NULL);
    }
    return sGame.result;
}
