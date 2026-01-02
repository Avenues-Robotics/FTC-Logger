package org.firstinspires.ftc.teamcode.logger;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * JSON Lines logger.
 *
 * Creates a run file:
 *   <external files>/ftc-logger/<OpMode>/<RunNumber>.jsonl
 *
 * Each row is a JSON object with at least:
 *   {"t": <time>, ...numeric fields...}
 *
 * The first line may contain:
 *   {"tUnit": "s" | "ms" | "ns"}
 */
public final class LogWriter implements AutoCloseable {

    private final BufferedWriter writer;
    private final File runFile;
    private final String initError;
    private String tUnit;

    /**
     * Creates a new logger for the given OpMode.
     *
     * @param context Android context used to resolve external files directory. Use`hardwareMap.appContext`
     * @param opModeName OpMode name, log files are grouped by OpMode.
     */
    public LogWriter(Context context, String opModeName) {
        BufferedWriter tmpWriter = null;
        File tmpRunFile = null;
        String error = null;
        try {
            File opDir = FileSystemUtilities.getOpModeDir(context, opModeName);
            tmpRunFile = new File(opDir, nextRunId(opDir) + ".jsonl");
            tmpWriter = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmpRunFile, true), StandardCharsets.UTF_8));
        } catch (FileNotFoundException e) {
            error = e.toString();
        }
        writer = tmpWriter;
        runFile = tmpRunFile;
        initError = error;
    }

    /**
     * Returns the OpMode directory containing the run file.
     *
     * @return OpMode directory.
     */
    public File getRunDir() {
        if (runFile == null) return null;
        return runFile.getParentFile();
    }

    /**
     * Returns the run file path.
     *
     * @return Run file.
     */
    public File getRunFile() {
        return runFile;
    }

    /**
     * Returns true if the writer was created successfully.
     *
     * @return True when ready to write.
     */
    public boolean isReady() {
        return writer != null;
    }

    /**
     * Returns the initialization error message, if any.
     *
     * @return Error message string or null.
     */
    public String getInitError() {
        return initError;
    }

    /**
     * Logs a row with time in seconds and key/value pairs.
     *
     * @param tSeconds Time in seconds.
     * @param keyValuePairs Alternating key/value entries (String, Number).
     */
    public void logSeconds(double tSeconds, Object... keyValuePairs) {
        logKVWithUnit(tSeconds, "s", keyValuePairs);
    }

    /**
     * Logs a row with time in milliseconds and key/value pairs.
     *
     * @param tMillis Time in milliseconds.
     * @param keyValuePairs Alternating key/value entries (String, Number).
     */
    public void logMilliseconds(double tMillis, Object... keyValuePairs) {
        logKVWithUnit(tMillis, "ms", keyValuePairs);
    }

    /**
     * Logs a row with time in nanoseconds and key/value pairs.
     *
     * @param tNanos Time in nanoseconds.
     * @param keyValuePairs Alternating key/value entries (String, Number).
     */
    public void logNanoseconds(double tNanos, Object... keyValuePairs) {
        logKVWithUnit(tNanos, "ns", keyValuePairs);
    }

    /**
     * Writes a JSON row with a time value and numeric fields.
     *
     * @param t Time in units matching {@code unit}.
     * @param unit Time unit string.
     * @param keyValuePairs Alternating key/value entries (String, Number).
     */
    private synchronized void logKVWithUnit(double t, String unit, Object... keyValuePairs) {
        try {
            if (writer == null) return;
            ensureUnit(unit);
            JSONObject o = new JSONObject();
            o.put("t", t);
            for (int i = 0; i + 1 < keyValuePairs.length; i += 2) {
                Object k = keyValuePairs[i];
                Object v = keyValuePairs[i + 1];
                if (!(k instanceof String)) continue;
                if (!(v instanceof Number)) continue;
                o.put((String) k, ((Number) v).doubleValue());
            }
            writer.write(o.toString());
            writer.write("\n");
            writer.flush();
        } catch (Exception ignored) { }
    }

    /**
     * Writes the time unit header once per file.
     *
     * @param unit Time unit string.
     */
    private void ensureUnit(String unit) {
        if (tUnit != null) return;
        if (writer == null) return;
        tUnit = unit;
        try {
            JSONObject header = new JSONObject();
            header.put("tUnit", unit);
            writer.write(header.toString());
            writer.write("\n");
            writer.flush();
        } catch (Exception ignored) { }
    }

    /**
     * Determines the next run number string for the OpMode folder.
     *
     * @param opDir OpMode directory.
     * @return Next run id, zero-padded.
     */
    private static String nextRunId(File opDir) {
        int max = -1;
        int width = 4;
        File[] children = opDir.listFiles();
        if (children != null) {
            for (File f : children) {
                if (!f.isFile()) continue;
                String name = f.getName();
                if (name.endsWith(".jsonl")) name = name.substring(0, name.length() - 6);
                if (!name.matches("\\d+")) continue;
                try {
                    int v = Integer.parseInt(name);
                    if (v > max) max = v;
                    if (name.length() > width) width = name.length();
                } catch (NumberFormatException ignored) { }
            }
        }

        int next = Math.max(1, max + 1);
        if (next >= Math.pow(10, width)) {
            int newWidth = width + 1;
            zeroPadRunFiles(opDir, newWidth);
            width = newWidth;
        }

        return String.format(Locale.US, "%0" + width + "d", next);
    }

    /**
     * Renames existing run files to a wider zero-padded width.
     *
     * @param opDir OpMode directory.
     * @param newWidth New width for numeric run ids.
     */
    private static void zeroPadRunFiles(File opDir, int newWidth) {
        File[] children = opDir.listFiles();
        if (children == null) return;
        for (File f : children) {
            if (!f.isFile()) continue;
            String name = f.getName();
            if (!name.endsWith(".jsonl")) continue;
            String base = name.substring(0, name.length() - 6);
            if (!base.matches("\\d+")) continue;
            try {
                int v = Integer.parseInt(base);
                String padded = String.format(Locale.US, "%0" + newWidth + "d", v) + ".jsonl";
                if (padded.equals(name)) continue;
                File dst = new File(opDir, padded);
                //noinspection ResultOfMethodCallIgnored
                f.renameTo(dst);
            } catch (NumberFormatException ignored) { }
        }
    }

    /**
     * Closes the underlying file writer.
     */
    @Override
    public synchronized void close() {
        try {
            if (writer != null) writer.close();
        } catch (Exception ignored) { }
    }
}
