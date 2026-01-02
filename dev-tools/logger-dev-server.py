#!/usr/bin/env python3
import argparse
import http.server
import json
from pathlib import Path
import urllib.request
from urllib.parse import parse_qs, urlparse
from http import HTTPStatus


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


def build_fake_data(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing fake log file: {path}")

    t_vals = []
    series = {}
    t_unit = None

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
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

    payload = {"t": t_vals, "series": series}
    if t_unit:
        payload["tUnit"] = t_unit
    return payload


def list_fake_runs():
    return [p.stem for p in sorted(Path(__file__).parent.glob("*.jsonl"))]


def list_fake_run_meta():
    runs = []
    for p in sorted(Path(__file__).parent.glob("*.jsonl")):
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
    return Path(__file__).parent / f"{name}.jsonl"


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
        for p in Path(__file__).parent.glob("*.jsonl"):
            p.unlink(missing_ok=True)
        return {"ok": True, "opMode": "DEV_TEST"}
    path = resolve_run_file(op_mode, run)
    path.unlink(missing_ok=True)
    return {"ok": True, "run": run}


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

        if self.path == "/":
            self.path = "/index.html"
        elif self.path.startswith("/logger/"):
            self.path = self.path[len("/logger"):]
            if self.path == "":
                self.path = "/"

        return super().do_GET()

    def proxy_api(self):
        target = f"{self.api_base}{self.path}"
        try:
            with urllib.request.urlopen(target) as resp:
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
        if parsed.path.startswith("/logger/api/opmodes"):
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
            payload = build_fake_data(run_file)
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

        if payload is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown fake endpoint")
            return

        body = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    def __init__(self, server_address, handler_class, api_base):
        self.api_base = api_base
        super().__init__(server_address, handler_class)


def main():
    parser = argparse.ArgumentParser(
        description="Serve local FTC logger UI and proxy /logger/api/* to the robot controller."
    )
    parser.add_argument(
        "--root",
        default="TeamCode/src/main/assets/logger",
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
    args = parser.parse_args()

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
        print("Serving fake /logger/api/* data")
    else:
        print(f"Proxying /logger/api/* to {args.robot}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
