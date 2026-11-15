/* Where the program is, for the files it keeps next to itself (its lists .mem and .dat, fonts, translations).

   Port_SelfExe(out, cap): the path into out (not terminated: the length is returned, as readlink does; <= 0: unknown).
   Linux: the link /proc/self/exe. Android: an app's program is the system's own (app_process), so the app names the
   place in BT3_EXE (port/android/app_main.c: the app's files folder + "/bt3_android"; nothing has to be at that
   path, only beside it); a program started from a shell has no BT3_EXE and is found as on Linux. */
#ifndef PORT_EXE_H
#define PORT_EXE_H
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static inline long Port_SelfExe(char *out, size_t cap) {
#ifdef __ANDROID__
    const char *e = getenv("BT3_EXE");
    if (e != NULL && e[0] != '\0') {
        size_t n = strlen(e);
        if (n > cap) {
            return -1;
        }
        memcpy(out, e, n);
        return (long)n;
    }
#endif
    return (long)readlink("/proc/self/exe", out, cap);
}
#endif
