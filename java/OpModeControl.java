package org.firstinspires.ftc.teamcode.logger.java;

import android.content.Context;

import com.qualcomm.ftccommon.FtcEventLoop;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.VoltageSensor;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.ftccommon.external.OnCreateEventLoop;
import org.firstinspires.ftc.robotcore.internal.opmode.RegisteredOpModes;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Lets the web UI select, init, start, and stop OpModes, like the Driver Station does.
 *
 * The OpMode manager is captured when the event loop is created (and again on every
 * "Restart Robot"). A listener tracks whether the active OpMode is in INIT or running,
 * so changes made from the Driver Station are reflected in the web UI too.
 */
public final class OpModeControl {
    private static final String TAG = "FtcLoggerControl";
    /** Name of the SDK's idle OpMode, active whenever nothing else is. */
    private static final String STOP_OPMODE = "$Stop$Robot$";

    private static volatile OpModeManagerImpl manager = null;
    private static volatile boolean started = false;
    /** Simple class name of the most recent user OpMode (matches its log folder). */
    private static volatile String lastOpModeClass = "";
    /** Wall-clock time of the most recent user OpMode INIT (0 = none yet). */
    private static volatile long lastInitMillis = 0;
    private static volatile Context appContext = null;
    /** Reads the most recent user OpMode's telemetry (null until one INITs). */
    private static volatile TelemetryReader telemetryReader = null;
    /** Files modified this long before INIT still count, to absorb clock/mtime granularity. */
    private static final long LIVE_RUN_SLACK_MS = 1000;
    /** Battery voltage is re-read at most this often, however fast the UI polls. */
    private static final long VOLTAGE_CACHE_MS = 1000;
    private static volatile double cachedVoltage = Double.NaN;
    private static volatile long cachedVoltageMillis = 0;
    /** Closed (and forgotten) when the current OpMode stops, e.g. LoggerTelemetry's log file. */
    private static final List<AutoCloseable> CLOSE_ON_STOP = new CopyOnWriteArrayList<>();

    private static final OpModeManagerNotifier.Notifications LISTENER =
            new OpModeManagerNotifier.Notifications() {
                @Override
                public void onOpModePreInit(OpMode opMode) {
                    started = false;
                    if (opMode != null && isUserOpMode(opMode)) {
                        lastOpModeClass = opMode.getClass().getSimpleName();
                        lastInitMillis = System.currentTimeMillis();
                        // Capture the SDK's telemetry now, before the OpMode can replace the field.
                        telemetryReader = TelemetryReader.of(opMode.telemetry);
                    }
                }

                @Override
                public void onOpModePreStart(OpMode opMode) {
                    started = true;
                }

                @Override
                public void onOpModePostStop(OpMode opMode) {
                    started = false;
                    for (AutoCloseable c : CLOSE_ON_STOP) {
                        try { c.close(); } catch (Exception e) { RobotLog.ee(TAG, e, "close on stop failed"); }
                    }
                    CLOSE_ON_STOP.clear();
                }
            };

    private OpModeControl() { }

    @OnCreateEventLoop
    public static void attachEventLoop(Context context, FtcEventLoop eventLoop) {
        try {
            appContext = context.getApplicationContext();
            OpModeManagerImpl prev = manager;
            if (prev != null) prev.unregisterListener(LISTENER);
            OpModeManagerImpl next = eventLoop.getOpModeManager();
            started = false;
            if (next != null) next.registerListener(LISTENER);
            manager = next;
        } catch (Throwable t) {
            RobotLog.ee(TAG, t, "Failed to attach OpMode control");
        }
    }

    /**
     * Returns the OpModes a driver can pick, like the Driver Station's lists.
     *
     * { "opModes": [ { "name": "...", "flavor": "autonomous"|"teleop", "group": "..." } ] }
     */
    public static JSONObject listJson() throws JSONException {
        JSONArray arr = new JSONArray();
        for (OpModeMeta meta : selectableOpModes()) {
            arr.put(new JSONObject()
                    .put("name", meta.name)
                    .put("flavor", meta.flavor == OpModeMeta.Flavor.AUTONOMOUS ? "autonomous" : "teleop")
                    .put("group", meta.group == null ? "" : meta.group));
        }
        return new JSONObject().put("opModes", arr);
    }

    /**
     * Returns the current OpMode state.
     *
     * { "ready": true, "state": "stopped"|"init"|"running", "active": "name", "lastClass": "SimpleName",
     *   "liveOpMode": "LogFolder", "liveRun": "0007", "batteryVoltage": 12.84,
     *   "telemetrySeq": "1a2b3c", "telemetry": { "lines": [...], "log": [...] } }
     *
     * liveOpMode/liveRun name the log file written by the most recent OpMode (the newest
     * .jsonl modified since its INIT), so the UI can plot it live. They are omitted until
     * that OpMode creates a LogWriter.
     *
     * batteryVoltage is omitted when no voltage sensor (Control/Expansion Hub) can be read.
     *
     * telemetry is only included when its seq differs from {@code telemetrySeqParam}.
     */
    public static JSONObject stateJson(String telemetrySeqParam) throws JSONException {
        OpModeManagerImpl m = manager;
        if (m == null) {
            return new JSONObject().put("ready", false).put("state", "unavailable").put("active", "");
        }
        String name = m.getActiveOpModeName();
        boolean idle = isIdle(name);
        String state = idle ? "stopped" : (started ? "running" : "init");
        JSONObject out = new JSONObject()
                .put("ready", true)
                .put("state", state)
                .put("active", idle ? "" : name)
                .put("lastClass", lastOpModeClass);
        double volts = batteryVoltage(m);
        if (!Double.isNaN(volts)) out.put("batteryVoltage", Math.round(volts * 100) / 100.0);
        File live = findLiveRunFile();
        if (live != null) {
            String file = live.getName();
            out.put("liveOpMode", live.getParentFile().getName())
               .put("liveRun", file.substring(0, file.length() - ".jsonl".length()));
        }

        // Telemetry is only included when it changed since the caller's last copy.
        TelemetryReader reader = telemetryReader;
        if (reader != null) {
            JSONObject telemetry = reader.snapshotJson();
            String seq = Integer.toHexString(telemetry.toString().hashCode());
            out.put("telemetrySeq", seq);
            if (!seq.equals(telemetrySeqParam)) out.put("telemetry", telemetry);
        }
        return out;
    }

    /** Equivalent to selecting an OpMode and pressing INIT on the Driver Station. */
    public static JSONObject initJson(String name) throws JSONException {
        OpModeManagerImpl m = requireManager();
        if (name == null || name.trim().isEmpty()) throw new IllegalArgumentException("Missing query param: name");
        if (!isIdle(m.getActiveOpModeName())) {
            throw new IllegalArgumentException("Stop the active OpMode first");
        }
        boolean known = false;
        for (OpModeMeta meta : selectableOpModes()) {
            if (meta.name.equals(name)) { known = true; break; }
        }
        if (!known) throw new IllegalArgumentException("Unknown OpMode: " + name);

        m.initOpMode(name);
        return new JSONObject().put("ok", true);
    }

    /** Equivalent to pressing START (▶) on the Driver Station. */
    public static JSONObject startJson() throws JSONException {
        OpModeManagerImpl m = requireManager();
        if (isIdle(m.getActiveOpModeName())) throw new IllegalArgumentException("No OpMode is initialized");
        if (started) throw new IllegalArgumentException("OpMode is already running");
        m.startActiveOpMode();
        return new JSONObject().put("ok", true);
    }

    /** Equivalent to pressing STOP (■) on the Driver Station. */
    public static JSONObject stopJson() throws JSONException {
        OpModeManagerImpl m = requireManager();
        if (!isIdle(m.getActiveOpModeName())) m.stopActiveOpMode();
        return new JSONObject().put("ok", true);
    }

    /** Closes {@code c} when the running OpMode stops (used to close log files). */
    static void closeOnStop(AutoCloseable c) {
        if (c != null) CLOSE_ON_STOP.add(c);
    }

    // ---- helpers ----

    /**
     * Lowest positive reading across the robot's voltage sensors (the usual FTC approach,
     * since an idle hub can report 0), cached for {@link #VOLTAGE_CACHE_MS}. NaN if none.
     */
    private static double batteryVoltage(OpModeManagerImpl m) {
        long now = System.currentTimeMillis();
        if (now - cachedVoltageMillis < VOLTAGE_CACHE_MS) return cachedVoltage;
        double result = Double.NaN;
        try {
            HardwareMap hw = m.getHardwareMap();
            if (hw != null) {
                double min = Double.POSITIVE_INFINITY;
                for (VoltageSensor sensor : hw.voltageSensor) {
                    double v = sensor.getVoltage();
                    if (v > 0 && v < min) min = v;
                }
                if (min != Double.POSITIVE_INFINITY) result = min;
            }
        } catch (Throwable t) {
            // Hardware map can be mid-rebuild (e.g. Restart Robot); report "unknown" this time.
        }
        cachedVoltage = result;
        cachedVoltageMillis = now;
        return result;
    }

    private static OpModeManagerImpl requireManager() {
        OpModeManagerImpl m = manager;
        if (m == null) throw new IllegalArgumentException("Robot is not ready");
        return m;
    }

    /** Newest run file (in any OpMode folder) modified since the last INIT, or null. */
    private static File findLiveRunFile() {
        Context ctx = appContext;
        long since = lastInitMillis;
        if (ctx == null || since == 0) return null;
        File[] opDirs = FileSystemUtilities.getRootDir(ctx).listFiles();
        if (opDirs == null) return null;

        File best = null;
        long cutoff = since - LIVE_RUN_SLACK_MS;
        for (File dir : opDirs) {
            if (!dir.isDirectory()) continue;
            File[] runs = dir.listFiles();
            if (runs == null) continue;
            for (File f : runs) {
                if (!f.isFile() || !f.getName().endsWith(".jsonl")) continue;
                long modified = f.lastModified();
                if (modified < cutoff) continue;
                if (best == null || modified > best.lastModified()) best = f;
            }
        }
        return best;
    }

    private static boolean isIdle(String activeName) {
        return activeName == null || activeName.isEmpty() || STOP_OPMODE.equals(activeName);
    }

    private static boolean isUserOpMode(OpMode opMode) {
        return !opMode.getClass().getName().startsWith("com.qualcomm.");
    }

    private static List<OpModeMeta> selectableOpModes() {
        RegisteredOpModes registered = RegisteredOpModes.getInstance();
        registered.waitOpModesRegistered();
        List<OpModeMeta> out = new ArrayList<>();
        for (OpModeMeta meta : registered.getOpModes()) {
            if (meta.flavor == OpModeMeta.Flavor.SYSTEM) continue;
            if (meta.name == null || meta.name.startsWith("$")) continue;
            out.add(meta);
        }
        out.sort((a, b) -> a.name.compareToIgnoreCase(b.name));
        return out;
    }
}
