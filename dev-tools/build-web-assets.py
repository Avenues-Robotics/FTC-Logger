#!/usr/bin/env python3
"""
Builds java/WebAssets.java from the web UI files in web/.

The robot serves the web UI from WebAssets.java, so teams only have to copy the logger
folder into TeamCode: no Gradle changes, no assets folder.

Run this after editing anything in web/ (the dev server serves web/ directly and warns
when WebAssets.java is out of date):

    python3 dev-tools/build-web-assets.py          # regenerate
    python3 dev-tools/build-web-assets.py --check  # exit 1 if out of date (for CI / pre-commit)
"""
import argparse
import hashlib
import sys
from pathlib import Path

LOGGER_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = LOGGER_DIR / "web"
OUT_FILE = LOGGER_DIR / "java" / "WebAssets.java"
PACKAGE = "org.firstinspires.ftc.teamcode.logger.java"

# Served files, in a fixed order (the order also defines the hash).
FILES = ["index.html", "style.css", "app.js"]

# Java limits each string constant to 65535 bytes (modified UTF-8). Stay well under it.
MAX_CHUNK_BYTES = 30000


def source_hash():
    """Hash of the web files' contents; stored in WebAssets.java to detect stale builds."""
    h = hashlib.sha256()
    for name in FILES:
        h.update(name.encode("utf-8") + b"\0")
        h.update((WEB_DIR / name).read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:16]


def built_hash():
    """The hash recorded in the current WebAssets.java, or None."""
    if not OUT_FILE.exists():
        return None
    for line in OUT_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("static final String SOURCE_HASH"):
            return line.split('"')[1]
    return None


def is_stale():
    return built_hash() != source_hash()


def java_escape(ch):
    """One character as Java string-literal source, plus its size in the class file."""
    if ch == "\\":
        return "\\\\", 1
    if ch == '"':
        return '\\"', 1
    if ch == "\n":
        return "\\n", 1
    if ch == "\r":
        return "\\r", 1
    if ch == "\t":
        return "\\t", 1
    code = ord(ch)
    if 0x20 <= code < 0x7F:
        return ch, 1
    # Everything else as \uXXXX (surrogate pairs above U+FFFF), so the .java file is pure ASCII.
    if code > 0xFFFF:
        code -= 0x10000
        hi, lo = 0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)
        return f"\\u{hi:04x}\\u{lo:04x}", 6
    # Size in the class file's modified UTF-8: U+0000 and U+0080..U+07FF take 2 bytes.
    size = 1 if 0 < code < 0x80 else 2 if code < 0x800 else 3
    return f"\\u{code:04x}", size


def chunks(text):
    """Splits text into Java string literals that each fit in one class-file constant."""
    out, cur, size = [], [], 0
    for ch in text:
        lit, n = java_escape(ch)
        if size + n > MAX_CHUNK_BYTES:
            out.append("".join(cur))
            cur, size = [], 0
        cur.append(lit)
        size += n
    if cur or not out:
        out.append("".join(cur))
    return out


def render():
    lines = [
        "// GENERATED FILE - DO NOT EDIT.",
        "// Built from logger/web/* by dev-tools/build-web-assets.py. Edit the files in web/,",
        "// then run:  python3 dev-tools/build-web-assets.py",
        f"package {PACKAGE};",
        "",
        "/** The logger web UI, compiled into the app so no Gradle or assets setup is needed. */",
        "final class WebAssets {",
        f'    static final String SOURCE_HASH = "{source_hash()}";',
        "",
        "    private WebAssets() { }",
        "",
        "    /** Contents of web/<name> (e.g. \"index.html\"), or null if there is no such file. */",
        "    static String get(String name) {",
        "        switch (name) {",
    ]
    for i, name in enumerate(FILES):
        lines.append(f'            case "{name}": return join(FILE_{i});')
    lines += [
        "            default: return null;",
        "        }",
        "    }",
        "",
        "    // Each file is split into several constants (Java caps a single one at 64 KB) and",
        "    // joined at runtime. An array keeps javac from folding them back into one constant.",
        "    private static String join(String[] parts) {",
        "        StringBuilder sb = new StringBuilder();",
        "        for (String p : parts) sb.append(p);",
        "        return sb.toString();",
        "    }",
    ]
    for i, name in enumerate(FILES):
        text = (WEB_DIR / name).read_text(encoding="utf-8")
        lines += ["", f"    // web/{name}", f"    private static final String[] FILE_{i} = {{"]
        for c in chunks(text):
            lines.append(f'        "{c}",')
        lines.append("    };")
    lines += ["}", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if WebAssets.java is out of date")
    args = ap.parse_args()

    if args.check:
        if is_stale():
            print(f"{OUT_FILE.name} is out of date. Run: python3 dev-tools/build-web-assets.py")
            return 1
        print(f"{OUT_FILE.name} is up to date.")
        return 0

    OUT_FILE.write_text(render(), encoding="utf-8", newline="\n")
    kb = OUT_FILE.stat().st_size / 1024
    print(f"Wrote {OUT_FILE.relative_to(LOGGER_DIR)} ({kb:.0f} KB) from web/{{{','.join(FILES)}}}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
