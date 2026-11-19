package org.firstinspires.ftc.teamcode.logger.java;

import android.content.Context;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import org.firstinspires.ftc.robotcore.external.Func;
import org.firstinspires.ftc.robotcore.external.Telemetry;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Telemetry that can also graph: one object for Driver Station telemetry and the logger plot.
 *
 * <pre>
 * LoggerTelemetry telemetry = new LoggerTelemetry(this);
 * waitForStart();
 * while (opModeIsActive()) {
 *     telemetry.addData("x", x);          // Driver Station, as usual
 *     telemetry.addGraph("x", x, "y", y); // logger graph
 *     telemetry.update();                 // sends telemetry AND writes one graph row
 * }
 * </pre>
 *
 * Every regular {@link Telemetry} call is passed straight through to the OpMode's telemetry,
 * so the Driver Station (and the logger's Telemetry panel) behave exactly as before.
 * </br>
 * Graph values collected with {@link #addGraph} are written as one row, stamped with the
 * time, on each {@link #update()}. Time is in seconds and starts at 0 on the first row
 * written (see {@link #resetGraphTime()}). The log file is only created once there is
 * something to graph, so OpModes that never call addGraph don't leave empty runs behind.
 * The file is closed automatically when the OpMode stops.
 */
public class LoggerTelemetry implements Telemetry, AutoCloseable {
    private final Telemetry base;
    private final Context context;
    private final String logName;

    /** Values added since the last update(), in the order first added. */
    private final Map<String, Double> pending = new LinkedHashMap<>();
    private LogWriter writer = null;
    private boolean writerFailed = false;
    private long startNanos = -1;

    /**
     * Wraps the OpMode's telemetry and logs to a folder named after the OpMode class.
     * Call it from {@code runOpMode()} / {@code init()}, once hardwareMap is available.
     */
    public LoggerTelemetry(OpMode opMode) {
        this(opMode.telemetry, opMode.hardwareMap.appContext, opMode.getClass().getSimpleName());
    }

    /**
     * Wraps any Telemetry (e.g. FTC Dashboard's MultipleTelemetry) and logs to {@code logName}.
     */
    public LoggerTelemetry(Telemetry base, Context context, String logName) {
        this.base = base;
        this.context = context;
        this.logName = logName;
        OpModeControl.closeOnStop(this);
    }

    // ---------------------------------------------------------------------------------------
    // Graphing
    // ---------------------------------------------------------------------------------------

    /**
     * Adds values to the graph: alternating names and numbers, e.g.
     * {@code addGraph("x", x, "y", y)}. They are written on the next {@link #update()}.
     * Calling it again before update() adds more series to the same row; reusing a
     * name replaces its value. NaN and infinite values are skipped.
     *
     * @throws IllegalArgumentException if the arguments aren't name/number pairs.
     */
    public synchronized LoggerTelemetry addGraph(Object... namesAndValues) {
        if (namesAndValues.length % 2 != 0) {
            throw new IllegalArgumentException(
                    "addGraph needs name/value pairs, like addGraph(\"x\", x, \"y\", y)");
        }
        for (int i = 0; i < namesAndValues.length; i += 2) {
            Object name = namesAndValues[i];
            Object value = namesAndValues[i + 1];
            if (!(name instanceof String)) {
                throw new IllegalArgumentException(
                        "addGraph argument " + (i + 1) + " should be a name (String), got " + describe(name));
            }
            if (!(value instanceof Number)) {
                throw new IllegalArgumentException(
                        "addGraph value for \"" + name + "\" should be a number, got " + describe(value));
            }
            double v = ((Number) value).doubleValue();
            if (Double.isNaN(v) || Double.isInfinite(v)) continue;
            pending.put((String) name, v);
        }
        return this;
    }

    /** Restarts graph time at 0 on the next row written. */
    public synchronized void resetGraphTime() {
        startNanos = -1;
    }

    /** True unless the log file could not be created. */
    public synchronized boolean isGraphReady() {
        return !writerFailed;
    }

    /** Writes the pending graph values (if any) as one row. */
    private synchronized void writeGraphRow() {
        if (pending.isEmpty() || writerFailed) {
            pending.clear();
            return;
        }
        if (writer == null) {
            writer = new LogWriter(context, logName);
            if (!writer.isReady()) {
                writerFailed = true;
                base.log().add("Graph logger failed to start: " + writer.getInitError());
                pending.clear();
                return;
            }
        }
        long now = System.nanoTime();
        if (startNanos < 0) startNanos = now;
        double t = (now - startNanos) / 1e9;

        Object[] kv = new Object[pending.size() * 2];
        int i = 0;
        for (Map.Entry<String, Double> e : pending.entrySet()) {
            kv[i++] = e.getKey();
            kv[i++] = e.getValue();
        }
        writer.logSeconds(t, kv);
        pending.clear();
    }

    /** Closes the log file. Called automatically when the OpMode stops. */
    @Override
    public synchronized void close() {
        pending.clear();
        if (writer != null) writer.close();
    }

    private static String describe(Object o) {
        return o == null ? "null" : o.getClass().getSimpleName() + " " + o;
    }

    // ---------------------------------------------------------------------------------------
    // Telemetry: update() also writes the graph row; everything else passes through.
    // ---------------------------------------------------------------------------------------

    @Override
    public boolean update() {
        writeGraphRow();
        return base.update();
    }

    @Override public Item addData(String caption, String format, Object... args) { return base.addData(caption, format, args); }
    @Override public Item addData(String caption, Object value) { return base.addData(caption, value); }
    @Override public <T> Item addData(String caption, Func<T> valueProducer) { return base.addData(caption, valueProducer); }
    @Override public <T> Item addData(String caption, String format, Func<T> valueProducer) { return base.addData(caption, format, valueProducer); }
    @Override public boolean removeItem(Item item) { return base.removeItem(item); }
    @Override public void clear() { base.clear(); }
    @Override public void clearAll() { base.clearAll(); }
    @Override public Object addAction(Runnable action) { return base.addAction(action); }
    @Override public boolean removeAction(Object token) { return base.removeAction(token); }
    @Override public void speak(String text) { base.speak(text); }
    @Override public void speak(String text, String languageCode, String countryCode) { base.speak(text, languageCode, countryCode); }
    @Override public Line addLine() { return base.addLine(); }
    @Override public Line addLine(String lineCaption) { return base.addLine(lineCaption); }
    @Override public boolean removeLine(Line line) { return base.removeLine(line); }
    @Override public boolean isAutoClear() { return base.isAutoClear(); }
    @Override public void setAutoClear(boolean autoClear) { base.setAutoClear(autoClear); }
    @Override public int getMsTransmissionInterval() { return base.getMsTransmissionInterval(); }
    @Override public void setMsTransmissionInterval(int ms) { base.setMsTransmissionInterval(ms); }
    @Override public String getItemSeparator() { return base.getItemSeparator(); }
    @Override public void setItemSeparator(String itemSeparator) { base.setItemSeparator(itemSeparator); }
    @Override public String getCaptionValueSeparator() { return base.getCaptionValueSeparator(); }
    @Override public void setCaptionValueSeparator(String separator) { base.setCaptionValueSeparator(separator); }
    @Override public void setDisplayFormat(DisplayFormat displayFormat) { base.setDisplayFormat(displayFormat); }
    @Override public void setNumDecimalPlaces(int minDecimalPlaces, int maxDecimalPlaces) { base.setNumDecimalPlaces(minDecimalPlaces, maxDecimalPlaces); }
    @Override public Log log() { return base.log(); }
}
