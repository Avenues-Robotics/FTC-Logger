#!/usr/bin/env python3
import argparse
import http.server
import json
import random
import re
import threading
import time
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse
from http import HTTPStatus


FAKE_DIR = Path(__file__).parent  # fake run files live next to this script

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def build_fake_data(path, offset=0):
    """Parses a run file like the robot's /data endpoint, optionally from a byte offset."""
    if not path.exists():
        raise FileNotFoundError(f"Missing fake log file: {path}")

    raw = path.read_bytes()
    reset = False
    if offset > len(raw):
        offset, reset = 0, True
    chunk = raw[offset:]

    t_vals = []
    series = {}
    t_unit = None
    consumed = 0

    lines = chunk.split(b"\n")
    for idx, line in enumerate(lines):
        is_last = idx == len(lines) - 1
        try:
            row = json.loads(line.decode("utf-8")) if line.strip() else None
        except (json.JSONDecodeError, UnicodeDecodeError):
            row = None
        if is_last:
            # Trailing text without a newline only counts once it's a full row.
            if row is None:
                break
            consumed += len(line)
        else:
            consumed += len(line) + 1
        if not isinstance(row, dict):
            continue

        if isinstance(row.get("tUnit"), str):
            t_unit = row.get("tUnit")
            continue

        t = row.get("t")
        if not isinstance(t, (int, float)):
            continue
        t_vals.append(float(t))

        for key, val in row.items():
            if key == "t" or not isinstance(val, (int, float)):
                continue
            series.setdefault(key, []).append(float(val))

    payload = {"t": t_vals, "series": series, "offset": offset + consumed}
    if t_unit:
        payload["tUnit"] = t_unit
    elif offset == 0:
        payload["tUnit"] = "s"
    if reset:
        payload["reset"] = True
    return payload


def list_fake_runs():
    # Newest first, matching the robot API (the UI opens the first run).
    return [p.stem for p in sorted(FAKE_DIR.glob("*.jsonl"), key=lambda p: p.name.lower(), reverse=True)]


def list_fake_run_meta():
    runs = []
    for p in sorted(FAKE_DIR.glob("*.jsonl")):
        runs.append({
            "name": p.stem,
            "bytes": p.stat().st_size,
            "modified": int(p.stat().st_mtime * 1000),
        })
    return runs


def resolve_run_file(op_mode, run):
    if op_mode and op_mode != "DEV_TEST":
        raise FileNotFoundError("Unknown OpMode")
    name = run or list_fake_runs()[0]
    if not name:
        raise FileNotFoundError("No runs found")
    return FAKE_DIR / f"{name}.jsonl"


def rename_fake_run(op_mode, run, suffix, base=None):
    if op_mode and op_mode != "DEV_TEST":
        raise FileNotFoundError("Unknown OpMode")
    if not run:
        raise ValueError("Missing run")
    src = resolve_run_file(op_mode, run)
    base_name = (base or "").strip()
    if not base_name:
        base_name = run.split(" ", 1)[0]
    safe = sanitize_suffix(suffix or "")
    if safe:
        new_name = f"{base_name} {safe}.jsonl"
    else:
        new_name = f"{base_name}.jsonl"
    dst = src.with_name(new_name)
    if src == dst:
        return {"ok": True, "run": dst.stem}
    if dst.exists():
        raise ValueError("Target already exists")
    src.rename(dst)
    return {"ok": True, "run": dst.stem}


def delete_fake_run(op_mode, run):
    if op_mode and op_mode != "DEV_TEST":
        raise FileNotFoundError("Unknown OpMode")
    if not run:
        for p in FAKE_DIR.glob("*.jsonl"):
            p.unlink(missing_ok=True)
        return {"ok": True, "opMode": "DEV_TEST"}
    path = resolve_run_file(op_mode, run)
    path.unlink(missing_ok=True)
    return {"ok": True, "run": run}


# In-memory stand-in for @Configurable classes (used with --fake).
FAKE_CONFIG = [
    {
        "name": "org.firstinspires.ftc.teamcode.ArmConstants",
        "simpleName": "ArmConstants", "displayName": "ArmConstants", "outerSimpleName": "ArmConstants",
        "fields": [
            {"name": "kP", "type": "double", "value": "0.012"},
            {"name": "kI", "type": "double", "value": "0.0"},
            {"name": "kD", "type": "double", "value": "0.0004"},
            {"name": "maxPower", "type": "double", "value": "0.8"},
        ],
    },
    {
        "name": "org.firstinspires.ftc.teamcode.DEV_TEST",
        "simpleName": "DEV_TEST", "displayName": "DEV_TEST", "outerSimpleName": "DEV_TEST",
        "fields": [
            {"name": "targetPosition", "type": "int", "value": "500"},
            {"name": "useFeedforward", "type": "boolean", "value": "true"},
            {"name": "mode", "type": "enum", "value": "HOLD", "options": ["HOLD", "MOVE", "IDLE"]},
            {"name": "label", "type": "string", "value": "test run"},
        ],
    },
    {
        "name": "org.firstinspires.ftc.teamcode.DriveTuner$Params",
        "simpleName": "Params", "displayName": "DriveTuner.Params", "outerSimpleName": "DriveTuner",
        "fields": [
            {"name": "trackWidth", "type": "double", "value": "14.5"},
            {"name": "ticksPerRev", "type": "int", "value": "537"},
        ],
    },
]

# Like the real robot, remember each field's starting ("in the code") value for reset.
for _cls in FAKE_CONFIG:
    for _f in _cls["fields"]:
        _f["codeValue"] = _f["value"]


def set_fake_config(class_name, field_name, value, reset=False):
    for cls in FAKE_CONFIG:
        if cls["name"] != class_name:
            continue
        for field in cls["fields"]:
            if field["name"] != field_name:
                continue
            if reset:
                field["value"] = field["codeValue"]
                return {"ok": True, "field": field}
            t = field["type"]
            v = value.strip()
            if t in ("int", "long", "short", "byte", "double", "float"):
                try:
                    v = str(int(v)) if t in ("int", "long", "short", "byte") else repr(float(v))
                except ValueError:
                    raise ValueError(f'Not a valid {t}: "{v}"')
            elif t == "boolean":
                if v.lower() not in ("true", "false"):
                    raise ValueError("Expected true or false")
                v = v.lower()
            elif t == "enum":
                if v not in field["options"]:
                    raise ValueError(f"No enum constant {v}")
            else:
                v = value
            field["value"] = v
            return {"ok": True, "field": field}
        raise ValueError(f"Unknown or unsupported field: {field_name}")
    raise ValueError(f"Unknown configurable class: {class_name}")


# ---------------------------------------------------------------------------
# Fake robot (used with --fake)
#
# Simulates the RC's OpMode manager so the Robot panel can be exercised locally:
#   - INIT takes a moment to apply (the real robot applies commands on its event loop)
#   - START runs a simulation that writes a new run file (0002.jsonl, 0003.jsonl, ...)
#     next to this script, under the DEV_TEST OpMode
#   - some OpModes end on their own, like a LinearOpMode whose loop finishes
#   - STOP (button or Space e-stop) ends the run immediately
# The arm simulation reads the fake @Configurable values every tick, so edits made in
# the Configurable panel show up in the log, even mid-run.
# ---------------------------------------------------------------------------
FAKE_INIT_DELAY_S = 0.4
FAKE_TICK_S = 0.02

FAKE_CONTROL_OPMODES = [
    # autoStopS: the OpMode ends itself after this many seconds (None = runs until stopped)
    {"name": "Auto Example", "flavor": "autonomous", "group": "Logger", "sim": "arm", "autoStopS": 5.0},
    {"name": "Arm PID Test", "flavor": "teleop", "group": "Logger", "sim": "arm", "autoStopS": None},
    {"name": "Logger Demo No Hardware", "flavor": "teleop", "group": "Logger", "sim": "noise", "autoStopS": 10.0},
]


def fake_config_value(simple_name, field, default):
    for cls in FAKE_CONFIG:
        if cls["simpleName"] != simple_name:
            continue
        for f in cls["fields"]:
            if f["name"] != field:
                continue
            if f["type"] in ("double", "float"):
                return float(f["value"])
            if f["type"] in ("int", "long"):
                return int(f["value"])
            if f["type"] == "boolean":
                return f["value"] == "true"
            return f["value"]
    return default


def next_fake_run_name():
    highest = 0
    for p in FAKE_DIR.glob("*.jsonl"):
        m = re.match(r"(\d+)", p.stem)
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{highest + 1:04d}"


class FakeRobot:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = "stopped"
        self.active = ""
        self.generation = 0  # bumps on every init/stop so stale timers/threads bail out
        self.live_run = ""   # run file of the most recent OpMode (created at INIT, like LogWriter)
        # Telemetry as the SDK composes it ("caption : value" lines + log), see TelemetryReader.java
        self.telemetry_lines = []
        self.telemetry_log = []

    def opmode(self, name):
        return next((m for m in FAKE_CONTROL_OPMODES if m["name"] == name), None)

    def set_telemetry(self, lines, log_line=None):
        with self.lock:
            self.telemetry_lines = list(lines)
            if log_line:
                self.telemetry_log.append(log_line)
                del self.telemetry_log[:-9]  # SDK default log capacity

    def snapshot(self, telemetry_seq=""):
        with self.lock:
            # Every fake run logs to DEV_TEST, so point the UI there after a stop.
            out = {"ready": True, "state": self.state, "active": self.active, "lastClass": "DEV_TEST"}
            # Fake battery: sags a little while an OpMode runs.
            sag = 0.45 if self.state == "running" else 0.0
            out["batteryVoltage"] = round(13.05 - sag + random.uniform(-0.04, 0.04), 2)
            if self.live_run:
                out["liveOpMode"] = "DEV_TEST"
                out["liveRun"] = self.live_run
            if self.telemetry_lines or self.telemetry_log:
                telemetry = {"lines": self.telemetry_lines, "log": self.telemetry_log}
                seq = format(hash(json.dumps(telemetry)) & 0xFFFFFFFF, "x")
                out["telemetrySeq"] = seq
                if seq != telemetry_seq:
                    out["telemetry"] = telemetry
            return out

    def init(self, name):
        with self.lock:
            if self.state != "stopped" or self.active:
                raise ValueError("Stop the active OpMode first")
            if not self.opmode(name):
                raise ValueError(f"Unknown OpMode: {name}")
            self.active = name  # queued; state flips to "init" after a short delay
            self.generation += 1
            gen = self.generation

        def apply():
            with self.lock:
                if self.generation == gen and self.active == name:
                    self.state = "init"
                    # Like `new LogWriter(...)` in runOpMode(): the file exists from INIT on.
                    self.live_run = next_fake_run_name()
                    (FAKE_DIR / f"{self.live_run}.jsonl").touch()
                    self.telemetry_log = []
                    self.telemetry_lines = ["Status : Initialized", f"OpMode : {name}", "Press START to run"]
                    self.telemetry_log.append(f"Logging to DEV_TEST/{self.live_run}.jsonl")
                    print(f"[fake robot] INIT  {name} -> DEV_TEST/{self.live_run}.jsonl")
        threading.Timer(FAKE_INIT_DELAY_S, apply).start()

    def start(self):
        with self.lock:
            if self.state == "stopped":
                raise ValueError("No OpMode is initialized")
            if self.state == "running":
                raise ValueError("OpMode is already running")
            self.state = "running"
            gen = self.generation
            op = self.opmode(self.active)
            run = self.live_run
        print(f"[fake robot] START {op['name']}")
        threading.Thread(target=self._run, args=(gen, op, run), daemon=True).start()

    def stop(self, reason="STOP"):
        with self.lock:
            if self.state == "stopped" and not self.active:
                return
            print(f"[fake robot] {reason} {self.active}")
            self.state = "stopped"
            self.active = ""
            self.generation += 1

    def _still_running(self, gen):
        with self.lock:
            return self.generation == gen and self.state == "running"

    def _run(self, gen, op, run):
        path = FAKE_DIR / f"{run}.jsonl"
        sim = ArmSim() if op["sim"] == "arm" else NoiseSim()
        t0 = time.monotonic()
        with path.open("a") as f:
            f.write(json.dumps({"tUnit": "s"}) + "\n")  # like logger.logSeconds(...)
            while self._still_running(gen):
                elapsed = time.monotonic() - t0
                if op["autoStopS"] is not None and elapsed >= op["autoStopS"]:
                    with self.lock:
                        if self.generation == gen:
                            print(f"[fake robot] {op['name']} finished on its own")
                            self.state, self.active = "stopped", ""
                            self.generation += 1
                    break
                row = {"t": round(elapsed, 4)}
                values = sim.step(FAKE_TICK_S)
                row.update(values)
                f.write(json.dumps(row) + "\n")
                f.flush()
                lines = ["Status : Running", f"Runtime : {elapsed:.1f} s"]
                if op["autoStopS"] is not None:
                    lines.append(f"Time left : {max(0.0, op['autoStopS'] - elapsed):.1f} s")
                lines += sim.telemetry()
                note = sim.event()
                self.set_telemetry(lines, note)
                time.sleep(FAKE_TICK_S)


class ArmSim:
    """Arm on a motor with a PD controller; gains come from the fake ArmConstants."""

    def __init__(self):
        self.pos = 0.0
        self.vel = 0.0

    def step(self, dt):
        target = fake_config_value("DEV_TEST", "targetPosition", 500)
        mode = fake_config_value("DEV_TEST", "mode", "HOLD")
        kp = fake_config_value("ArmConstants", "kP", 0.012)
        kd = fake_config_value("ArmConstants", "kD", 0.0004)
        max_power = abs(fake_config_value("ArmConstants", "maxPower", 0.8))

        if mode == "IDLE":
            power = 0.0
        else:
            power = kp * (target - self.pos) - kd * self.vel
            power = max(-max_power, min(max_power, power))

        accel = 4000.0 * power - 6.0 * self.vel  # motor torque minus friction
        self.vel += accel * dt
        self.pos += self.vel * dt
        measured = self.pos + random.gauss(0, 1.5)  # encoder noise
        self.last = (measured, target, power, mode, kp, kd)
        return {
            "armPosition": round(measured, 2),
            "armTarget": target,
            "armPower": round(power, 4),
            "armVelocity": round(self.vel, 2),
        }


    def telemetry(self):
        measured, target, power, mode, kp, kd = self.last
        # Formatted like the SDK: numbers via DecimalFormat("0.####"), addLine() captions prefix items
        return [
            f"Mode : {mode}",
            f"Arm : {measured:.0f} / {target} ticks",
            f"Power : {power:.2f}",
            f"Gainskp : {kp:g} | kd : {kd:g}",
        ]

    def event(self):
        measured, target = self.last[0], self.last[1]
        err = abs(measured - target)
        was = getattr(self, "_settled", False)
        if not was and err < 5:
            self._settled = True
            return f"Arm reached {target}"
        if was and err > 25:  # hysteresis so encoder noise doesn't re-trigger it
            self._settled = False
        return None


class NoiseSim:
    """Mirrors LoggerDemoNoHardware: a noisy constant and a noisy line."""

    def __init__(self):
        self.t_ms = 0.0

    def step(self, dt):
        self.t_ms += dt * 1000.0
        self.last = {
            "x": round(500.0 + 20.0 * random.gauss(0, 1), 3),
            "y": round(0.5 * self.t_ms + 1.0 + 40.0 * random.gauss(0, 1), 3),
        }
        return self.last

    def telemetry(self):
        return [f"t : {self.t_ms / 1000.0:.2f} s", f"x : {self.last['x']:.2f}", f"y : {self.last['y']:.2f}"]

    def event(self):
        return None


FAKE_ROBOT = FakeRobot()


def fake_control(action, name, tseq=""):
    if action == "opmodes":
        return {"opModes": [
            {"name": m["name"], "flavor": m["flavor"], "group": m["group"]} for m in FAKE_CONTROL_OPMODES
        ]}
    if action == "state":
        return FAKE_ROBOT.snapshot(tseq)
    if action == "init":
        FAKE_ROBOT.init(name)
        return {"ok": True}
    if action == "start":
        FAKE_ROBOT.start()
        return {"ok": True}
    if action == "stop":
        FAKE_ROBOT.stop()
        return {"ok": True}
    return None


def sanitize_suffix(suffix):
    s = suffix.strip()
    s = s.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    out = []
    for ch in s:
        if ch.isalnum() or ch in "._ -":
            out.append(ch)
        else:
            out.append("_")
    return "".join(out).strip()


class LoggerDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, api_base=None, use_fake=False, **kwargs):
        self.api_base = api_base.rstrip("/")
        self.use_fake = use_fake
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        if self.path.startswith("/logger/api/"):
            if self.use_fake:
                return self.fake_api()
            return self.proxy_api()

        if self.path in ("/", "/logger", "/logger/", "/logger/index.html", "/index.html"):
            check_web_assets()  # each page load: catch web/ edits that weren't rebuilt
        if self.path in ("/", "/logger"):
            self.path = "/index.html"
        elif self.path.startswith("/logger/"):
            self.path = self.path[len("/logger"):]
            if self.path == "":
                self.path = "/"

        return super().do_GET()

    def proxy_api(self):
        target = f"{self.api_base}{self.path}"
        try:
            try:
                resp = urllib.request.urlopen(target)
            except urllib.error.HTTPError as err:
                resp = err  # forward robot error responses (e.g. 400 with a JSON message)
            with resp:
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    if key.lower() in HOP_BY_HOP:
                        continue
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(resp.read())
        except Exception as exc:
            self.send_error(HTTPStatus.BAD_GATEWAY, f"Proxy error: {exc}")

    def fake_api(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        run = (qs.get("run") or [""])[0]
        op_mode = (qs.get("opMode") or ["DEV_TEST"])[0]

        payload = None
        if parsed.path.startswith("/logger/api/control/"):
            action = parsed.path[len("/logger/api/control/"):].strip("/")
            try:
                payload = fake_control(action, (qs.get("name") or [""])[0], (qs.get("tseq") or [""])[0])
            except ValueError as exc:
                return self.send_json_error(str(exc))
        elif parsed.path.startswith("/logger/api/opmodes"):
            payload = {"opModes": ["DEV_TEST"]}
        elif parsed.path.startswith("/logger/api/runs"):
            payload = {"opMode": "DEV_TEST", "runs": list_fake_runs()}
        elif parsed.path.startswith("/logger/api/run"):
            run_file = resolve_run_file(op_mode, run)
            payload = {
                "opMode": "DEV_TEST",
                "run": run or "",
                "exists": run_file.exists(),
                "bytes": run_file.stat().st_size if run_file.exists() else 0,
            }
        elif parsed.path.startswith("/logger/api/data"):
            run_file = resolve_run_file(op_mode, run)
            try:
                offset = int((qs.get("offset") or ["0"])[0] or 0)
            except ValueError:
                return self.send_json_error("Invalid offset")
            payload = build_fake_data(run_file, max(0, offset))
        elif parsed.path.startswith("/logger/api/fs"):
            payload = {
                "opModes": [
                    {"name": "DEV_TEST", "runs": list_fake_run_meta()}
                ]
            }
        elif parsed.path.startswith("/logger/api/rename"):
            suffix = (qs.get("suffix") or [""])[0]
            base = (qs.get("base") or [""])[0]
            payload = rename_fake_run(op_mode, run, suffix, base)
        elif parsed.path.startswith("/logger/api/delete"):
            payload = delete_fake_run(op_mode, run)
        elif parsed.path.startswith("/logger/api/config"):
            payload = {"classes": FAKE_CONFIG}
        elif parsed.path.startswith("/logger/api/setconfig"):
            try:
                payload = set_fake_config(
                    (qs.get("class") or [""])[0],
                    (qs.get("field") or [""])[0],
                    (qs.get("value") or [""])[0],
                    reset=(qs.get("reset") or [""])[0] == "1",
                )
            except ValueError as exc:
                return self.send_json_error(str(exc))

        if payload is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown fake endpoint")
            return

        body = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


    def send_json_error(self, message):
        body = json.dumps({"ok": False, "error": message}).encode("utf-8")
        self.send_response(HTTPStatus.BAD_REQUEST)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    def __init__(self, server_address, handler_class, api_base):
        self.api_base = api_base
        super().__init__(server_address, handler_class)


# ---------------------------------------------------------------------------
# WebAssets.java freshness: the robot serves the web UI compiled into WebAssets.java,
# while this server serves web/ directly. Warn when they no longer match.
# ---------------------------------------------------------------------------
_assets_was_stale = None


def check_web_assets(force_print=False):
    """Prints a warning when java/WebAssets.java is out of date with web/ (once per change)."""
    global _assets_was_stale
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "build_web_assets", Path(__file__).resolve().parent / "build-web-assets.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        stale = mod.is_stale()
    except Exception as exc:  # never break the dev server over this
        print(f"(Could not check WebAssets.java: {exc})")
        return
    if stale != _assets_was_stale or force_print:
        if stale:
            print("\n*** java/WebAssets.java is OUT OF DATE with web/. The robot will serve the old UI.")
            print("*** Run:  python3 dev-tools/build-web-assets.py\n")
        elif _assets_was_stale:
            print("java/WebAssets.java is up to date again.")
    _assets_was_stale = stale


def main():
    parser = argparse.ArgumentParser(
        description="Serve local FTC logger UI and proxy /logger/api/* to the robot controller."
    )
    parser.add_argument(
        "--root",
        default="TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/web",
        help="Path to the logger asset directory.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--robot",
        default="http://192.168.43.1:8080",
        help="Robot controller base URL (scheme://host:port).",
    )
    parser.add_argument(
        "--fake",
        action="store_true",
        help="Serve a built-in fake run instead of proxying to the robot.",
    )
    parser.add_argument(
        "--fake-dir",
        default=None,
        help="Folder for fake run files (default: next to this script). New runs from the fake robot are written here.",
    )
    args = parser.parse_args()

    global FAKE_DIR
    if args.fake_dir:
        FAKE_DIR = Path(args.fake_dir).expanduser().resolve()
        FAKE_DIR.mkdir(parents=True, exist_ok=True)

    handler = lambda *h_args, **h_kwargs: LoggerDevHandler(
        *h_args,
        directory=args.root,
        api_base=args.robot,
        use_fake=args.fake,
        **h_kwargs,
    )

    httpd = ThreadingHTTPServer((args.host, args.port), handler, api_base=args.robot)
    print(f"Serving {args.root} at http://{args.host}:{args.port}/")
    if args.fake:
        print(f"Serving fake /logger/api/* data from {FAKE_DIR}")
        print("Fake robot ready: INIT / START / STOP from the Robot panel write new runs there")
    else:
        print(f"Proxying /logger/api/* to {args.robot}")
    check_web_assets()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
