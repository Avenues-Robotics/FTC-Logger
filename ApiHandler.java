package org.firstinspires.ftc.teamcode.logger;

import android.content.Context;

import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * API handler for retrieving log files.
 *
 * Filesystem layout:
 *   <external files>/ftc-logger/<OpMode>/<RunNumber>.jsonl
 *
 * Endpoints:
 *   GET /logger/api/opmodes
 *   GET /logger/api/runs?opMode=NAME
 *   GET /logger/api/run?opMode=NAME&run=RUN
 *   GET /logger/api/data?opMode=NAME&run=RUN
 *   GET /logger/api/fs
 *   GET /logger/api/rename?opMode=NAME&run=RUN&suffix=SUFFIX
 *   GET /logger/api/delete?opMode=NAME&run=RUN
 */
public final class ApiHandler implements WebHandler {

    public enum Route { OPMODES, RUNS, RUN_META, DATA, FS, RENAME, DELETE }

    private final Context context;
    private final Route route;

    public ApiHandler(Context context, Route route) {
        this.context = context.getApplicationContext();
        this.route = route;
    }

    /**
     * Dispatches a request for the configured route.
     *
     * @param session HTTP session for the incoming request.
     * @return HTTP JSON response for the route.
     */
    @Override
    public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
        try {
            switch (route) {
                case OPMODES:
                    return okJson(opModesJson());
                case RUNS:
                    return okJson(runsJson(getFirstQuery(session, "opMode")));
                case RUN_META:
                    return okJson(runMetaJson(getFirstQuery(session, "opMode"), getFirstQuery(session, "run")));
                case DATA:
                    return okJson(dataJson(getFirstQuery(session, "opMode"), getFirstQuery(session, "run")));
                case FS:
                    return okJson(fsJson());
                case RENAME:
                    return okJson(renameJson(
                            getFirstQuery(session, "opMode"),
                            getFirstQuery(session, "run"),
                            getFirstQuery(session, "suffix"),
                            getFirstQuery(session, "base")));
                case DELETE:
                    return okJson(deleteJson(
                            getFirstQuery(session, "opMode"),
                            getFirstQuery(session, "run")));
                default:
                    return badRequest("Unknown route");
            }
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (Throwable e) {
            return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.INTERNAL_ERROR,
                    "application/json; charset=utf-8",
                    new JSONObjectSafe().put("ok", false).put("error", String.valueOf(e)).toString()
            );
        }
    }

    /**
     * Returns the list of OpMode folders under the logger root directory.
     *
     * @return JSON payload containing OpMode names.
     */
    private JSONObject opModesJson() throws JSONException {
        File root = FileSystemUtilities.getRootDir(context);
        JSONArray modes = new JSONArray();
        File[] children = root.listFiles();
        if (children != null) {
            Arrays.sort(children, Comparator.comparing(File::getName, String::compareToIgnoreCase));
            for (File f : children) if (f.isDirectory()) modes.put(f.getName());
        }
        return new JSONObject().put("opModes", modes);
    }

    /**
     * Returns run file names for the provided OpMode (without .jsonl extension).
     *
     * @param opMode OpMode name.
     * @return JSON payload containing run names.
     */
    private JSONObject runsJson(String opMode) throws JSONException {
        requireNonEmpty(opMode, "Missing query param: opMode");

        File opDir = new File(FileSystemUtilities.getRootDir(context), opMode);
        JSONArray runs = new JSONArray();

        File[] children = opDir.listFiles();
        if (children != null) {
            Arrays.sort(children, (a, b) -> b.getName().compareToIgnoreCase(a.getName()));
            for (File f : children) {
                if (!f.isFile()) continue;
                String name = f.getName();
                if (!name.endsWith(".jsonl")) continue;
                runs.put(name.substring(0, name.length() - 6));
            }
        }

        return new JSONObject().put("opMode", opMode).put("runs", runs);
    }

    /**
     * Returns metadata for a specific run folder.
     *
     * @param opMode OpMode name.
     * @param run Run folder name.
     * @return JSON payload containing run metadata.
     */
    private JSONObject runMetaJson(String opMode, String run) throws JSONException {
        requireNonEmpty(opMode, "Missing query param: opMode");
        requireNonEmpty(run, "Missing query param: run");

        File log = resolveRunFile(opMode, run);

        return new JSONObject()
                .put("opMode", opMode)
                .put("run", run)
                .put("exists", log.exists())
                .put("bytes", log.exists() ? log.length() : 0);
    }

    /**
     * Returns the OpMode/run file structure for management UI.
     *
     * @return JSON payload containing OpMode folders and run files.
     */
    private JSONObject fsJson() throws JSONException {
        File root = FileSystemUtilities.getRootDir(context);
        JSONArray modes = new JSONArray();
        File[] children = root.listFiles();
        if (children != null) {
            Arrays.sort(children, Comparator.comparing(File::getName, String::compareToIgnoreCase));
            for (File opDir : children) {
                if (!opDir.isDirectory()) continue;
                JSONArray runs = new JSONArray();
                File[] runFiles = opDir.listFiles();
                if (runFiles != null) {
                    Arrays.sort(runFiles, Comparator.comparing(File::getName, String::compareToIgnoreCase));
                    for (File f : runFiles) {
                        if (!f.isFile()) continue;
                        String name = f.getName();
                        if (!name.endsWith(".jsonl")) continue;
                        String base = name.substring(0, name.length() - 6);
                        runs.put(new JSONObject()
                                .put("name", base)
                                .put("bytes", f.length())
                                .put("modified", f.lastModified()));
                    }
                }
                modes.put(new JSONObject()
                        .put("name", opDir.getName())
                        .put("runs", runs));
            }
        }
        return new JSONObject().put("opModes", modes);
    }

    /**
     * Renames a run by replacing (or removing) the suffix after the first space.
     *
     * @param opMode OpMode name.
     * @param run Run name without extension.
     * @param suffix New suffix to apply (may be empty to remove).
     * @param baseOverride Optional base name to use instead of parsing {@code run}.
     * @return JSON payload describing the rename result.
     */
    private JSONObject renameJson(String opMode, String run, String suffix, String baseOverride) throws JSONException {
        requireNonEmpty(opMode, "Missing query param: opMode");
        requireNonEmpty(run, "Missing query param: run");

        if (!isSafeName(run)) throw new IllegalArgumentException("Invalid run name");

        String base = run;
        if (baseOverride != null && !baseOverride.trim().isEmpty()) {
            base = baseOverride.trim();
        } else {
            int spaceIndex = run.indexOf(" ");
            if (spaceIndex >= 0) base = run.substring(0, spaceIndex);
        }
        if (!isSafeName(base)) throw new IllegalArgumentException("Invalid base name");

        String safeSuffix = sanitizeSuffix(suffix);

        File opDir = new File(FileSystemUtilities.getRootDir(context), opMode);
        File src = resolveRunFile(opMode, run);
        if (!src.exists()) throw new IllegalArgumentException("Run not found");

        String newBase = safeSuffix.isEmpty() ? base : base + " " + safeSuffix;
        if (newBase.equals(run)) {
            return new JSONObject().put("ok", true).put("run", newBase);
        }
        File dst = new File(opDir, newBase + ".jsonl");
        if (dst.exists()) throw new IllegalArgumentException("Target already exists");
        if (!src.renameTo(dst)) throw new IllegalArgumentException("Rename failed");

        return new JSONObject().put("ok", true).put("run", newBase);
    }

    /**
     * Deletes a run file or an entire OpMode directory.
     *
     * @param opMode OpMode name.
     * @param run Run name (optional).
     * @return JSON payload describing the delete result.
     */
    private JSONObject deleteJson(String opMode, String run) throws JSONException {
        requireNonEmpty(opMode, "Missing query param: opMode");
        File opDir = new File(FileSystemUtilities.getRootDir(context), opMode);
        if (!opDir.exists()) throw new IllegalArgumentException("OpMode not found");

        boolean ok;
        if (run == null || run.trim().isEmpty()) {
            ok = deleteRecursive(opDir);
            return new JSONObject().put("ok", ok).put("opMode", opMode);
        }

        if (!isSafeName(run)) throw new IllegalArgumentException("Invalid run name");
        File log = resolveRunFile(opMode, run);
        ok = log.delete();
        return new JSONObject().put("ok", ok).put("run", run);
    }

    /**
     * Returns:
     * {
     *   "t": [ ... ],
     *   "series": { "fieldName": [ ... ], ... }
     * }
     *
     * Expects each log line to be JSON:
     *   {"t": <number>, "key": <number>, ...}
     *
     * @param opMode OpMode name.
     * @param run Run folder name.
     * @return JSON payload containing time series data.
     */
    private JSONObject dataJson(String opMode, String run) throws Exception {
        requireNonEmpty(opMode, "Missing query param: opMode");
        requireNonEmpty(run, "Missing query param: run");

        File log = resolveRunFile(opMode, run);
        if (!log.exists()) {
            throw new IllegalArgumentException("Log not found: " + log.getAbsolutePath());
        }

        List<Double> t = new ArrayList<>();
        JSONObject series = new JSONObject();
        String tUnit = "s";

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(log), StandardCharsets.UTF_8))) {

            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                JSONObject row;
                try {
                    row = new JSONObject(line);
                } catch (JSONException ignored) {
                    continue;
                }

                if (row.has("tUnit")) {
                    tUnit = row.optString("tUnit", tUnit);
                    continue;
                }
                if (row.has("t_unit")) {
                    tUnit = row.optString("t_unit", tUnit);
                    continue;
                }
                if (!row.has("t")) continue;
                double ti = row.optDouble("t", Double.NaN);
                if (Double.isNaN(ti)) continue;

                t.add(ti);

                for (java.util.Iterator<String> it = row.keys(); it.hasNext(); ) {
                    String key = it.next();
                    if ("t".equals(key)) continue;

                    Object v = row.opt(key);
                    if (!(v instanceof Number)) continue;

                    JSONArray arr = series.optJSONArray(key);
                    if (arr == null) {
                        arr = new JSONArray();
                        series.put(key, arr);
                    }
                    arr.put(((Number) v).doubleValue());
                }
            }
        }

        JSONArray tArr = new JSONArray();
        for (double ti : t) tArr.put(ti);

        return new JSONObject().put("t", tArr).put("series", series).put("tUnit", tUnit);
    }

    // ---- helpers ----

    /**
     * Creates a 200 OK JSON response.
     *
     * @param obj JSON payload to return.
     * @return HTTP response.
     */
    private static NanoHTTPD.Response okJson(JSONObject obj) {
        return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.OK,
                "application/json; charset=utf-8",
                obj.toString()
        );
    }

    /**
     * Creates a 400 Bad Request JSON response with an error message.
     *
     * @param message Error message.
     * @return HTTP response.
     */
    private static NanoHTTPD.Response badRequest(String message) {
        return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                "application/json; charset=utf-8",
                new JSONObjectSafe().put("ok", false).put("error", message).toString()
        );
    }

    /**
     * Returns the first query parameter value or an empty string.
     *
     * @param session HTTP session for the incoming request.
     * @param key Query parameter name.
     * @return First parameter value or empty string.
     */
    private static String getFirstQuery(NanoHTTPD.IHTTPSession session, String key) {
        Map<String, List<String>> params = session.getParameters();
        List<String> vals = params.get(key);
        if (vals == null || vals.isEmpty()) return "";
        return vals.get(0);
    }

    /**
     * Throws if the provided string is null/blank.
     *
     * @param s Value to check.
     * @param error Error message to throw.
     */
    private static void requireNonEmpty(String s, String error) {
        if (s == null || s.trim().isEmpty()) throw new IllegalArgumentException(error);
    }

    /**
     * Resolves a run parameter to a .jsonl file under the OpMode directory.
     *
     * @param opMode OpMode name.
     * @param run Run number or filename (with/without .jsonl).
     * @return Log file for the run.
     */
    private File resolveRunFile(String opMode, String run) {
        File opDir = new File(FileSystemUtilities.getRootDir(context), opMode);
        String name = run;
        if (!name.endsWith(".jsonl")) name = name + ".jsonl";
        return new File(opDir, name);
    }

    private static boolean isSafeName(String name) {
        return !(name.contains("/") || name.contains("\\") || name.contains(".."));
    }

    private static String sanitizeSuffix(String suffix) {
        String s = suffix == null ? "" : suffix.trim();
        s = s.replaceAll("[\\r\\n\\t]+", " ");
        s = s.replaceAll("[^A-Za-z0-9._ -]+", "_");
        return s.trim();
    }

    private static boolean deleteRecursive(File f) {
        if (f == null || !f.exists()) return false;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        return f.delete();
    }

    /** Tiny helper to build JSON without checked exceptions. */
    private static final class JSONObjectSafe {
        private final JSONObject o = new JSONObject();

        JSONObjectSafe put(String k, Object v) {
            try { o.put(k, v); } catch (JSONException ignored) { }
            return this;
        }

        @Override public String toString() { return o.toString(); }
    }
}
