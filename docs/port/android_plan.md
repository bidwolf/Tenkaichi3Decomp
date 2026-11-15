# Android port: plan

The Android port is EXPERIMENTAL: built on a Mac, run from a shell on the emulator, no app yet.

Status 2026-11-15: the arm64 build (`BT3_CC=android64`) runs the attract-demo fight headless to the end on the
Android 15 arm64 emulator with the same fight state as the macOS build on all 4428 vertical blanks (`BT3_HASH`), and
the macOS build made from the same sources gives the same fight as before (4428 of 4428). An APK
(`port/android/build_apk.py`) starts on that emulator: the game draws through SDL_GPU's Vulkan back end (the
emulator's software Vulkan: slow), reads the game data from the app's folder, opens sound (AAudio), and answers the
controller drawn on the screen (language screen chosen with it, the opening logos play). Not checked: a real phone,
a fight in the app, a controller, sound heard, the F1 window by touch, anything online. This file is the plan and the
record of what was checked; update it as steps land.

Target phone: the user's Samsung S25 (arm64, Vulkan).

## Ground rule

Players on Linux, Windows and macOS see no change. Every Android change sits behind `__ANDROID__`, `PORT_WINDOW` (the
window memory model, macOS and Android) or the `android64` variant. The demo-fight state must stay equal to the other
builds', so that online matches between a phone and a computer work.

## How it differs from macOS

The memory model is the macOS one (`docs/port/macos_plan.md`): the game's 4-byte pointers are offsets in a 4 GB
window, made by the pass in `port/tools/macwin/macwin.cpp`. What changes:

- **The window's address is fixed: 64 GB** (`ANDROID_WINDOW` in `port/tools/toolchain.py`, `PORT_WINDOW` in
  `port/src/port_addr.h`, `WINDOW` in `port/android/run.c`: the three must agree). macOS's 1 TB does not exist on
  phones with a 39-bit address space (512 GB). A multiple of 4 GB, so the low 32 bits of an address are the game
  address.
- **The program is linked for its address, not relocated.** ELF on arm64 has no relocation for "symbol minus the
  program's start" in 4 bytes (Mach-O's subtractor), which the tables' pointers and the game's static pointers need.
  With the window fixed they are `symbol - window` (pass option `-bt3-fixed`, `macho.elf` for the tables), a sum the
  linker does when the output is not position-independent. So `link.py` links like an executable (`-no-pie`,
  `--image-base` = window + 0x20000000), exports the symbols, and marks the file a shared object (`e_type`), which
  Android's loader accepts.
- **Loading** (`port/android/run.c`): reserve the window's 4 GB (`PROT_NONE`), `android_dlopen_ext` with
  `ANDROID_DLEXT_RESERVED_ADDRESS` at window + 0x20000000 (the loader then maps the image exactly there, load bias 0),
  call `__wrap_main`. The port maps the PS2 regions with `MAP_FIXED` over the reservation (`plat_mem.c`).
- **Compilers.** The game's kind of code (software float, 4-byte pointers) through Homebrew's LLVM with
  `--target=aarch64-linux-android30` and the NDK's sysroot; the NDK's clang (LLVM 19) has no `__ptr32` on arm64. The
  renderer, the C++ and the link through the NDK. `-fsigned-char` everywhere: `char` is unsigned on Linux's arm64 and
  signed on the PS2, x86 and Apple's arm64.
- **Pages.** Regions and the written-page tracking of `state.c` work in 16 KB, right for phones with 4 KB and with
  16 KB pages.
- **SDL3** is the release's Android package, unpacked to `port/build/android/sdl3` (`include/`, `lib/libSDL3.so`,
  `classes.jar`). SDL functions that ask the Java side crash in a program started from a shell: `run.c` answers
  `SDL_GetBasePath` itself, and Discord presence is off on Android (`discord.c`).
- **Crash report**: registers and, in place of `backtrace()` (not in Android 11's C library), the chain of saved
  frame pointers named with `dladdr`.

## Building and running the headless test

```
BT3_CC=android64 .venv/bin/python port/tools/undefined.py     # needs the Android NDK and Homebrew's LLVM
BT3_CC=android64 .venv/bin/python port/tools/link.py          # -> port/build/bt3_android (+ .mem, _run)
adb push port/build/bt3_android      /data/local/tmp/bt3/libbt3.so
adb push port/build/bt3_android_run  /data/local/tmp/bt3/bt3_android
adb push port/build/bt3_android.mem  /data/local/tmp/bt3/bt3_android.mem
adb push port/build/android/sdl3/lib/libSDL3.so /data/local/tmp/bt3/
adb push gamedata /data/local/tmp/bt3/                         # 2.9 GB, from the user's own disc
adb shell "cd /data/local/tmp/bt3 && LD_LIBRARY_PATH=. BT3_DEMO=1 BT3_SETTINGS= BT3_GS=none BT3_HASH=hash.txt ./bt3_android"
```

Compare the third column onwards of `hash.txt` with the same run of another build (the second column, the checksum
of all memory, differs between any two builds). Without `gamedata` the game prints "file not found" without end:
limit the log.

The Android build shares `port/build/gen` with the Mac build (`shaders.h`, `port_version.h`, `stubs.c`): build the Mac
game again after an Android build before trusting those files.

## The app

- `port/android/build_apk.py` packs it without Gradle (aapt2, d8, zipalign, apksigner): `libbt3.so` (the game),
  `libmain.so` (`app_main.c`), `libSDL3.so`, SDL's Java classes with `RinhaActivity`, and under `assets/files` what
  the game keeps next to its program (`.mem`, `.dat`, fonts, translations, the online screens' art). It refuses a game
  built with the disc's tables: build with `BT3_SKELETON=1`, as the PC releases are, so the APK holds no game data.
- The app's folder is `Android/data/com.rinhaonline.bt3/files` on the shared storage: the assets are copied there at
  the first start of each installed version, the game runs with it as its current directory (`gamedata/`, `saves/`,
  settings, `bt3_log.txt`), and `BT3_EXE` names it as the program's place (`port/src/port_exe.h`). Without
  `gamedata` there the app says where to put it and stops.
- **The game's thread is made with the window's stack region as its stack** (`pthread_attr_setstack`, `app_main.c`;
  `__wrap_main` then calls the game without switching). Switching to that stack inside SDL's thread, as the other
  builds do, made every call into Java fail without a word: Android's runtime takes a stack pointer outside the
  stack a thread was made with for a stack overflow (seen as "Could not fetch native window").
- Landscape only (`SDL_HINT_ORIENTATIONS`: SDL lets a resizable window turn otherwise), full screen.
- The controller on the screen: `port/src/gs/touch_pad.c` (touches to player 1's pad, a stick planted where the left
  thumb lands), drawn by `ui.cpp`; its F1 button opens the settings window. Shown from the first touch on.
- Signed with `~/.bt3-fork-keys/android.keystore` (made 2026-11-15, "CN=Rinha Online"; never in the repository). An
  update must be signed with the same key or Android refuses to install it over the old one.

## Steps

1. **Headless on the emulator, same fight as the other builds.** Done.
2. **An app with picture and sound.** Starts on the emulator (above). Left: the S25, a fight, speed, sound heard;
   `gs_gl.c` (desktop OpenGL: 60 `gl*` stubs) left out of the build; 64 GB free in an app process was true on the
   emulator only.
3. **Controller, then touch.** A first controller on the screen exists; the F1 window and the lobby screens by touch,
   and a Bluetooth controller, are not checked.
4. **Game data**: made on a computer from each player's own disc and copied into the app's folder (`adb push`, or a
   file manager over USB); 68 thousand files, slow to copy. A single archive the app unpacks would be kinder.
5. **Online**: a lobby between the phone and a Mac, through the relay.

## Not done, not checked

- A real phone; an app process; 16 KB-page devices; phones with a 39-bit address space.
- Rollback (`BT3_SYNCTEST`), netplay, sound, input, the renderer, the settings window.
- Builds from the blank tables (`BT3_SKELETON=1`, `make_dat.py`: it does not read lld's map yet).
- The in-game updater (an app cannot replace itself: updates would be a new APK).
- Discord presence: Discord's Social SDK has Android support (account linking, or its RPC route with the Discord
  app installed); the desktop socket the fork uses does not exist on a phone.
