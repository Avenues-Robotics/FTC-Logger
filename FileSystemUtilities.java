package org.firstinspires.ftc.teamcode.logger;

import android.content.Context;

import java.io.File;

/** Filesystem layout utilities for FTC Logger. */
public final class FileSystemUtilities {

    private FileSystemUtilities() { }

    /** Root: <external files>/ftc-logger */
    public static File getRootDir(Context context) {
        File base = context.getExternalFilesDir(null);
        if (base == null) base = context.getFilesDir();
        File root = new File(base, "ftc-logger");
        //noinspection ResultOfMethodCallIgnored
        root.mkdirs();
        return root;
    }

    /** Ensures opmode folder exists. */
    public static File getOpModeDir(Context context, String opModeName) {
        File dir = new File(getRootDir(context), sanitize(opModeName));
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    public static String sanitize(String name) {
        if (name == null) return "UnknownOpMode";
        // Keep it filesystem safe
        return name.replaceAll("[^A-Za-z0-9._-]+", "_");
    }
}
