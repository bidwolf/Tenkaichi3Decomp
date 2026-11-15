package com.rinhaonline.bt3;

import android.content.res.AssetManager;
import android.os.Bundle;
import android.util.Log;

import org.libsdl.app.SDLActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/* SDL's activity for the game. Before SDL starts the game's thread, the files the game keeps next to its program
   (its lists, fonts, translations: the APK's assets under "files") are copied to the app's files folder on the shared
   storage (Android/data/com.rinhaonline.bt3/files), once per installed version. The game data from the player's own
   disc goes into that same folder, as "gamedata" (port/android/app_main.c says so when it is missing). */
public class RinhaActivity extends SDLActivity {
    private static final String TAG = "bt3";

    @Override
    protected String[] getLibraries() {
        return new String[] {"SDL3", "main"};
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            File dir = getExternalFilesDir(null);
            if (dir != null) {
                long version = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
                File stamp = new File(dir, ".files-of");
                String have = stamp.exists() ? new String(java.nio.file.Files.readAllBytes(stamp.toPath())) : "";
                if (!have.equals(Long.toString(version))) {
                    copy(getAssets(), "files", dir);
                    try (OutputStream o = new FileOutputStream(stamp)) {
                        o.write(Long.toString(version).getBytes());
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "the game's files could not be copied", e);
        }
        super.onCreate(savedInstanceState);
    }

    private static void copy(AssetManager assets, String from, File to) throws java.io.IOException {
        String[] names = assets.list(from);
        if (names == null || names.length == 0) { /* a file */
            try (InputStream in = assets.open(from); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            return;
        }
        to.mkdirs();
        for (String name : names) {
            copy(assets, from + "/" + name, new File(to, name));
        }
    }
}
