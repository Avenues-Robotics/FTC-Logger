package org.firstinspires.ftc.teamcode.logger.java;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Reads what an OpMode's telemetry last sent to the Driver Station, for the web UI.
 *
 * The SDK's TelemetryImpl keeps the exact lines it transmitted ({@code composedLines}) and the
 * log entries ({@code log.entries}), both guarded by {@code theLock}. Reading those gives the
 * same text the Driver Station shows (formatting, separators, lines, actions, log order)
 * without wrapping or changing the OpMode's telemetry in any way.
 *
 * The reader keeps the original TelemetryImpl, captured at INIT, so it keeps working if the
 * OpMode later replaces {@code telemetry} (for example with FTC Dashboard's MultipleTelemetry).
 * If the SDK internals ever change, {@link #of} returns null and the panel simply stays empty.
 */
final class TelemetryReader {
    private final Object telemetry;
    private final Field lockField;
    private final Field linesField;
    private final Field logField;

    private TelemetryReader(Object telemetry, Field lockField, Field linesField, Field logField) {
        this.telemetry = telemetry;
        this.lockField = lockField;
        this.linesField = linesField;
        this.logField = logField;
    }

    /** Returns a reader for {@code telemetry}, or null if it isn't the SDK's TelemetryImpl. */
    static TelemetryReader of(Object telemetry) {
        if (telemetry == null) return null;
        Field lock = findField(telemetry.getClass(), "theLock");
        Field lines = findField(telemetry.getClass(), "composedLines");
        Field log = findField(telemetry.getClass(), "log");
        if (lock == null || lines == null) return null;
        return new TelemetryReader(telemetry, lock, lines, log);
    }

    /**
     * { "lines": ["Status : Running", ...], "log": ["...", ...] }
     */
    JSONObject snapshotJson() throws JSONException {
        List<String> lines = new ArrayList<>();
        List<String> logLines = new ArrayList<>();
        boolean newestFirst = false;

        try {
            Object lock = lockField.get(telemetry);
            synchronized (lock != null ? lock : this) {
                Object composed = linesField.get(telemetry);
                if (composed instanceof List) {
                    for (Object o : (List<?>) composed) lines.add(String.valueOf(o));
                }

                Object log = logField == null ? null : logField.get(telemetry);
                if (log != null) {
                    Field entries = findField(log.getClass(), "entries");
                    Field order = findField(log.getClass(), "displayOrder");
                    Object list = entries == null ? null : entries.get(log);
                    if (list instanceof List) {
                        for (Object o : (List<?>) list) logLines.add(String.valueOf(o));
                    }
                    Object ord = order == null ? null : order.get(log);
                    newestFirst = ord != null && String.valueOf(ord).startsWith("NEWEST");
                }
            }
        } catch (Throwable ignored) {
            // Leave whatever was collected; never fail the request.
        }

        if (newestFirst) Collections.reverse(logLines);

        JSONArray linesArr = new JSONArray();
        for (String s : lines) linesArr.put(s);
        JSONArray logArr = new JSONArray();
        for (String s : logLines) logArr.put(s);
        return new JSONObject().put("lines", linesArr).put("log", logArr);
    }

    private static Field findField(Class<?> cls, String name) {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException ignored) {
                // keep looking in the superclass
            } catch (Throwable t) {
                return null;
            }
        }
        return null;
    }
}
