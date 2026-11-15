"""Which build this is and which tools it uses; shared by undefined.py, link.py and strip_data.py.

    BT3_CC=gcc       (default) 32-bit, gcc                      -> port/build/bt3
    BT3_CC=clang     32-bit, the game code through clang        -> port/build/bt3_clang
    BT3_CC=clang64   64-bit Linux                               -> port/build/bt3_64
    BT3_CC=win64     64-bit Windows                             -> port/build/bt3.exe
                     On Linux: cross-compiled (mingw-w64: x86_64-w64-mingw32-gcc, clang with the mingw target; SDL3's
                     mingw development package unpacked under port/build/win or named by BT3_SDL3).
                     On Windows: in the MSYS2 CLANG64 or UCRT64/MINGW64 shell, with that shell's own tools.
    BT3_CC=mac64     64-bit macOS on Apple Silicon (arm64)      -> port/build/bt3_mac
                     Homebrew's LLVM (`brew install llvm`; BT3_LLVM names another bin/ folder): Apple's clang drops
                     the 4-byte pointers on arm64. The game's addresses are offsets in a 4 GB window instead of
                     low addresses (macOS keeps the low 4 GB unmapped): see docs/port/macos_plan.md.
    BT3_CC=android64 64-bit Android (arm64), built on a Mac    -> port/build/bt3_android
                     The macOS build's memory model (WINDOW below) with the window at a fixed address, the game's
                     code through Homebrew's LLVM and everything else through the NDK: see docs/port/android_plan.md."""
import os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
VARIANT = os.environ.get("BT3_CC", "gcc")
WIN = VARIANT == "win64"
MAC = VARIANT == "mac64"
ANDROID = VARIANT == "android64"
WINDOW = MAC or ANDROID  # the game's addresses are offsets in a 4 GB window (port/tools/macwin/macwin.cpp)
BITS64 = VARIANT in ("clang64", "win64", "mac64", "android64")
ON_WINDOWS = os.name == "nt" or sys.platform in ("msys", "cygwin")
PREFIX = "x86_64-w64-mingw32-" if WIN and not ON_WINDOWS else ""
MAC_TRIPLE = "arm64-apple-macos11"
LLVM = pathlib.Path(os.environ.get("BT3_LLVM", "/opt/homebrew/opt/llvm/bin")) if WINDOW else None
# Android: the window's address (64 GB: inside the 39-bit address space of the smallest arm64 phones, and a multiple
# of 4 GB, so that the low 32 bits of an address in it are the game address). The program is linked for
# ANDROID_WINDOW + 0x20000000 and loaded exactly there (port/android/run.c).
ANDROID_WINDOW = 0x1000000000
ANDROID_TRIPLE = "aarch64-linux-android30"

def ndk():
    """The Android NDK's folder of compilers (BT3_NDK names the NDK; else the newest under the SDK)."""
    if os.environ.get("BT3_NDK"):
        root = pathlib.Path(os.environ["BT3_NDK"])
    else:
        sdk = pathlib.Path(os.environ.get("ANDROID_HOME") or pathlib.Path.home() / "Library/Android/sdk")
        found = sorted((sdk / "ndk").glob("*/toolchains/llvm/prebuilt/*/bin"))
        if not found:
            raise SystemExit("FAILED no Android NDK found (BT3_NDK=<its folder>, or install one with Android Studio)")
        return found[-1]
    return next(iter(sorted(root.glob("toolchains/llvm/prebuilt/*/bin"))))

def ndk_sysroot():
    return ndk().parent / "sysroot"

def android_sdl3():
    """SDL3 for Android (its release's prefab folder for arm64: include/ and libs/): BT3_SDL3, or port/build/android."""
    if os.environ.get("BT3_SDL3"):
        return pathlib.Path(os.environ["BT3_SDL3"])
    return ROOT / "port/build/android/sdl3"

def llvm(tool):
    """An LLVM tool by name: Homebrew's for the macOS build, the one on PATH otherwise."""
    return str(LLVM / tool) if WINDOW else tool

def mac_sdk():
    return subprocess.run(["xcrun", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()

CLANG_TARGET = (["--target=x86_64-w64-mingw32"] if WIN else [f"--target={MAC_TRIPLE}", "-isysroot", mac_sdk()] if MAC else
                [f"--target={ANDROID_TRIPLE}", f"--sysroot={ndk_sysroot()}", "-fsigned-char"] if ANDROID else [])
OBJ = ROOT / ("port/build/obj" if VARIANT == "gcc" else "port/build/obj_" + VARIANT)
DATA = ROOT / ("port/build/obj_data" if not BITS64 else "port/build/obj_data_win64" if WIN else
               "port/build/obj_data_mac64" if MAC else "port/build/obj_data_android64" if ANDROID else "port/build/obj_data64")
EXE = ROOT / "port/build" / {"gcc": "bt3", "clang64": "bt3_64", "win64": "bt3.exe", "mac64": "bt3_mac", "android64": "bt3_android"}.get(VARIANT, "bt3_" + VARIANT)

def sdl3():
    """The folder with SDL3's include/ and lib/ for the Windows build, or None when the compiler finds it itself."""
    if not WIN:
        return None
    if os.environ.get("BT3_SDL3"):
        return pathlib.Path(os.environ["BT3_SDL3"])
    found = sorted((ROOT / "port/build/win").glob("SDL3-*/x86_64-w64-mingw32"))
    return found[-1] if found else None
