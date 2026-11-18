package org.firstinspires.ftc.teamcode.logger.java;

import android.content.Context;

import com.qualcomm.robotcore.util.RobotLog;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

import dalvik.system.DexFile;

/**
 * Finds {@link Configurable} classes in the TeamCode package and reads/writes their
 * public static fields via reflection.
 *
 * The APK is scanned once (on the first request) and the class list is cached.
 * Values are always read fresh, so the dashboard shows the current value of each field.
 */
public final class ConfigRegistry {
    private static final String TAG = "FtcLoggerConfig";
    private static final String TEAMCODE_PREFIX = "org.firstinspires.ftc.teamcode.";
    /** Skip the logger's own implementation classes. */
    private static final String LOGGER_IMPL_PREFIX = "org.firstinspires.ftc.teamcode.logger.java.";

    private static List<Class<?>> cachedClasses = null;

    private ConfigRegistry() { }

    /**
     * Returns all configurable classes and their fields.
     *
     * {
     *   "classes": [
     *     { "name": "org...ArmTuner", "simpleName": "ArmTuner", "displayName": "ArmTuner",
     *       "outerSimpleName": "ArmTuner",
     *       "fields": [ { "name": "kP", "type": "double", "value": "0.01" }, ... ] }
     *   ]
     * }
     */
    public static synchronized JSONObject listJson(Context context) throws JSONException {
        JSONArray arr = new JSONArray();
        for (Class<?> c : getClasses(context)) {
            JSONArray fields = new JSONArray();
            for (Field f : configurableFields(c)) {
                fields.put(fieldJson(f));
            }
            if (fields.length() == 0) continue;
            arr.put(new JSONObject()
                    .put("name", c.getName())
                    .put("simpleName", c.getSimpleName())
                    .put("displayName", displayName(c))
                    .put("outerSimpleName", outermost(c).getSimpleName())
                    .put("fields", fields));
        }
        return new JSONObject().put("classes", arr);
    }

    /**
     * Sets a field from its string value and returns the field's new state.
     *
     * @param className Fully-qualified class name (as returned by {@link #listJson}).
     * @param fieldName Field name.
     * @param value New value as text.
     */
    public static synchronized JSONObject setJson(Context context, String className, String fieldName, String value)
            throws JSONException {
        Class<?> target = null;
        for (Class<?> c : getClasses(context)) {
            if (c.getName().equals(className)) { target = c; break; }
        }
        if (target == null) throw new IllegalArgumentException("Unknown configurable class: " + className);

        Field field = null;
        for (Field f : configurableFields(target)) {
            if (f.getName().equals(fieldName)) { field = f; break; }
        }
        if (field == null) throw new IllegalArgumentException("Unknown or unsupported field: " + fieldName);

        Object parsed = parse(field.getType(), value);
        try {
            field.set(null, parsed);
        } catch (IllegalAccessException e) {
            throw new IllegalArgumentException("Cannot set field: " + e.getMessage());
        }
        RobotLog.ii(TAG, "Set %s.%s = %s", target.getSimpleName(), fieldName, String.valueOf(parsed));
        return new JSONObject().put("ok", true).put("field", fieldJson(field));
    }

    // ---- scanning ----

    private static List<Class<?>> getClasses(Context context) {
        if (cachedClasses != null) return cachedClasses;

        List<Class<?>> found = new ArrayList<>();
        ClassLoader loader = context.getClassLoader();
        DexFile dex = null;
        try {
            //noinspection deprecation
            dex = new DexFile(context.getPackageCodePath());
            Enumeration<String> entries = dex.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement();
                if (!name.startsWith(TEAMCODE_PREFIX) || name.startsWith(LOGGER_IMPL_PREFIX)) continue;
                try {
                    // initialize=false: don't run static initializers for every class we look at
                    Class<?> c = Class.forName(name, false, loader);
                    if (isConfigurable(c)) found.add(c);
                } catch (Throwable ignored) {
                    // Classes that fail to load are simply skipped.
                }
            }
        } catch (Throwable t) {
            RobotLog.ee(TAG, t, "Failed to scan for @Configurable classes");
        } finally {
            if (dex != null) {
                try { dex.close(); } catch (Throwable ignored) { }
            }
        }

        Collections.sort(found, (a, b) -> displayName(a).compareToIgnoreCase(displayName(b)));
        RobotLog.ii(TAG, "Found %d @Configurable classes", found.size());
        cachedClasses = found;
        return found;
    }

    private static boolean isConfigurable(Class<?> c) {
        for (Annotation a : c.getDeclaredAnnotations()) {
            if ("Configurable".equals(a.annotationType().getSimpleName())) return true;
        }
        return false;
    }

    private static List<Field> configurableFields(Class<?> c) {
        List<Field> out = new ArrayList<>();
        Field[] declared;
        try {
            declared = c.getDeclaredFields();
        } catch (Throwable t) {
            return out;
        }
        for (Field f : declared) {
            int m = f.getModifiers();
            if (!Modifier.isPublic(m) || !Modifier.isStatic(m) || Modifier.isFinal(m)) continue;
            if (f.isSynthetic()) continue;
            if (typeName(f.getType()) == null) continue;
            f.setAccessible(true); // needed when the class itself is not public
            out.add(f);
        }
        return out;
    }

    // ---- field <-> JSON ----

    private static JSONObject fieldJson(Field f) throws JSONException {
        Class<?> type = f.getType();
        Object v;
        try {
            v = f.get(null);
        } catch (Throwable t) {
            v = null;
        }
        JSONObject o = new JSONObject()
                .put("name", f.getName())
                .put("type", typeName(type))
                // Always send text so NaN/Infinity and long values survive JSON
                .put("value", v == null ? JSONObject.NULL : (type.isEnum() ? ((Enum<?>) v).name() : String.valueOf(v)));
        if (type.isEnum()) {
            JSONArray opts = new JSONArray();
            Object[] constants = type.getEnumConstants();
            if (constants != null) for (Object e : constants) opts.put(((Enum<?>) e).name());
            o.put("options", opts);
        }
        return o;
    }

    /** Returns a short type name for supported types, or null if unsupported. */
    private static String typeName(Class<?> t) {
        if (t == int.class || t == Integer.class) return "int";
        if (t == long.class || t == Long.class) return "long";
        if (t == short.class || t == Short.class) return "short";
        if (t == byte.class || t == Byte.class) return "byte";
        if (t == double.class || t == Double.class) return "double";
        if (t == float.class || t == Float.class) return "float";
        if (t == boolean.class || t == Boolean.class) return "boolean";
        if (t == String.class) return "string";
        if (t.isEnum()) return "enum";
        return null;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object parse(Class<?> t, String raw) {
        String s = raw == null ? "" : raw.trim();
        try {
            if (t == String.class) return raw == null ? "" : raw;
            if (t == int.class || t == Integer.class) return Integer.parseInt(s);
            if (t == long.class || t == Long.class) return Long.parseLong(s);
            if (t == short.class || t == Short.class) return Short.parseShort(s);
            if (t == byte.class || t == Byte.class) return Byte.parseByte(s);
            if (t == double.class || t == Double.class) return Double.parseDouble(s);
            if (t == float.class || t == Float.class) return Float.parseFloat(s);
            if (t == boolean.class || t == Boolean.class) {
                if ("true".equalsIgnoreCase(s)) return true;
                if ("false".equalsIgnoreCase(s)) return false;
                throw new IllegalArgumentException("Expected true or false");
            }
            if (t.isEnum()) return Enum.valueOf((Class<? extends Enum>) t, s);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Not a valid " + typeName(t) + ": \"" + s + "\"");
        }
        throw new IllegalArgumentException("Unsupported type: " + t.getName());
    }

    // ---- naming ----

    private static Class<?> outermost(Class<?> c) {
        Class<?> cur = c;
        while (cur.getEnclosingClass() != null) cur = cur.getEnclosingClass();
        return cur;
    }

    /** "ArmTuner" or "ArmTuner.Params" for nested classes. */
    private static String displayName(Class<?> c) {
        String n = c.getName();
        int dot = n.lastIndexOf('.');
        if (dot >= 0) n = n.substring(dot + 1);
        return n.replace('$', '.');
    }
}
