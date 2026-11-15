#!/usr/bin/env python3
"""Packs the Android build into an APK, without Gradle: the SDK's own tools (aapt2, d8, zipalign, apksigner).

    BT3_SKELETON=1 BT3_VERSION=<n> BT3_CC=android64 port/tools/undefined.py && ... port/tools/link.py
    port/android/build_apk.py [--out <file.apk>] [--keystore <file>]   -> port/build/android/RinhaOnline.apk

The game must have been built from the blank data tables (BT3_SKELETON=1: port/build/bt3_android.dat is there), so
that the APK holds none of the disc's data, as the PC releases do. In the APK:
    lib/arm64-v8a/   libbt3.so (the game), libmain.so (port/android/app_main.c), libSDL3.so
    classes.dex      SDL's activity (classes.jar of SDL3's release) and RinhaActivity
    assets/files/    what the game keeps next to its program: bt3_android.mem and .dat, fonts/, translations/, tbo/ui
Signed with ~/.bt3-fork-keys/android.keystore when it is there (alias androiddebugkey, password android), else with
Android's debug key (~/.android/debug.keystore): installing a later APK over this one needs the same key."""
import argparse, os, pathlib, shutil, subprocess, sys, zipfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
os.environ["BT3_CC"] = "android64"
from toolchain import ROOT, EXE, ANDROID_TRIPLE, ndk, android_sdl3

HERE = ROOT / "port/android"
B = ROOT / "port/build/android"
PACKAGE_API = 35

def sh(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)
    if r.returncode:
        raise SystemExit(f"FAILED {pathlib.Path(str(cmd[0])).name}: {(r.stdout + r.stderr).strip()[-1500:]}")
    return r.stdout

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(B / "RinhaOnline.apk"))
    own = pathlib.Path.home() / ".bt3-fork-keys/android.keystore"  # (the fork's own key, kept outside the repository)
    ap.add_argument("--keystore", default=str(own if own.exists() else pathlib.Path.home() / ".android/debug.keystore"))
    a = ap.parse_args()
    sdk = pathlib.Path(os.environ.get("ANDROID_HOME") or pathlib.Path.home() / "Library/Android/sdk")
    tools = sorted((sdk / "build-tools").glob("*/aapt2"))[-1].parent
    jar = sdk / f"platforms/android-{PACKAGE_API}/android.jar"
    dat = pathlib.Path(str(EXE) + ".dat")
    if not dat.exists() or not (ROOT / "port/build/obj_data_android64/SKELETON").exists():
        raise SystemExit("FAILED the game was not built from the blank tables (BT3_SKELETON=1): the APK would hold the disc's data")
    ver = next((l.split('"')[1] for l in (ROOT / "port/build/gen/gs/port_version.h").read_text().splitlines() if "PORT_VERSION" in l), "dev")
    code = 1
    if ver != "dev":
        n = [int(x) for x in ver.split(".") if x.isdigit()] + [0, 0, 0, 0]
        code = n[0] * 1000000 + n[1] * 100000 + n[2] * 100 + n[3]
    work = B / "apk"
    shutil.rmtree(work, ignore_errors=True)
    (work / "lib/arm64-v8a").mkdir(parents=True)
    # native: the game, SDL, and the app's loader
    shutil.copy2(EXE, work / "lib/arm64-v8a/libbt3.so")
    shutil.copy2(android_sdl3() / "lib/libSDL3.so", work / "lib/arm64-v8a/libSDL3.so")
    sh([ndk() / "clang", f"--target={ANDROID_TRIPLE}", "-O2", "-Wall", "-shared", "-fPIC", f"-I{android_sdl3() / 'include'}", HERE / "app_main.c",
        "-o", work / "lib/arm64-v8a/libmain.so", f"-L{android_sdl3() / 'lib'}", "-lSDL3", "-llog", "-ldl", "-Wl,-z,max-page-size=16384"])
    # Java: SDL's classes and the activity, to one classes.dex
    (work / "classes").mkdir()
    sh(["javac", "--release", "11", "-nowarn", "-cp", f"{jar}:{android_sdl3() / 'classes.jar'}", "-d", work / "classes"] +
       sorted((HERE / "java").rglob("*.java")))
    sh([tools / "d8", "--lib", jar, "--min-api", "30", "--output", work, android_sdl3() / "classes.jar"] + sorted((work / "classes").rglob("*.class")))
    # assets: the files the game looks for next to its program
    files = work / "assets/files"
    files.mkdir(parents=True)
    shutil.copy2(str(EXE) + ".mem", files / "bt3_android.mem")
    shutil.copy2(dat, files / "bt3_android.dat")
    shutil.copytree(ROOT / "port/third_party/fonts", files / "fonts")
    for kind in ("labels", "ui", "port"):
        (files / "translations" / kind).mkdir(parents=True)
        for s in sorted((ROOT / "port/translations" / kind).glob("*.json")):
            shutil.copy2(s, files / "translations" / kind / s.name)
    (files / "tbo/ui").mkdir(parents=True)
    for p in sorted((ROOT / "port/tbo/ui").glob("*.png")):
        shutil.copy2(p, files / "tbo/ui" / p.name)
    (files / "licenses").mkdir()
    for src, name in (("LICENSE", "tenkaichi3decomp-agpl.txt"), ("LICENSE-MIT", "tenkaichi3decomp-mit.txt"), ("port/third_party/imgui/LICENSE.txt", "dear-imgui.txt"),
                      ("port/third_party/newlib_libm/COPYING.NEWLIB", "newlib.txt"), ("port/build/android/dl/z/LICENSE.txt", "sdl3.txt")):
        if (ROOT / src).exists():
            shutil.copy2(ROOT / src, files / "licenses" / name)
    # resources (the icon), manifest, package
    (work / "res/mipmap").mkdir(parents=True)
    shutil.copy2(ROOT / "port/assets/icon/icon.png", work / "res/mipmap/ic_launcher.png")
    sh([tools / "aapt2", "compile", "--dir", work / "res", "-o", work / "res.zip"])
    sh([tools / "aapt2", "link", "-o", work / "base.apk", "--manifest", HERE / "AndroidManifest.xml", "-I", jar, "-A", work / "assets", work / "res.zip",
        "--min-sdk-version", "30", "--target-sdk-version", str(PACKAGE_API), "--version-code", str(code), "--version-name", ver])
    with zipfile.ZipFile(work / "base.apk", "a", zipfile.ZIP_DEFLATED) as z:
        z.write(work / "classes.dex", "classes.dex")
        for so in sorted((work / "lib/arm64-v8a").glob("*.so")):
            z.write(so, f"lib/arm64-v8a/{so.name}")
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    sh([tools / "zipalign", "-P", "16", "4", work / "base.apk", out])
    sh([tools / "apksigner", "sign", "--ks", a.keystore, "--ks-pass", "pass:android", "--key-pass", "pass:android", "--ks-key-alias", "androiddebugkey", out])
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: version {ver} ({code}), {out.stat().st_size / 1e6:.1f} MB")

main()
