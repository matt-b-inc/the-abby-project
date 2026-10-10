#!/usr/bin/env python
"""Serve a Unity Web build and real Django APIs against disposable test data.

Loopback only. Never loads .env or uses the project's database. Stop with Ctrl+C
or --stop-file; fixture accounts and their progress disappear on shutdown.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
import time
from urllib.parse import unquote
from wsgiref.simple_server import WSGIServer, make_server

from prototype_fixture_server import configure_django, fixture_wsgi, seed_fixture


class PreviewServer(WSGIServer):
    request_queue_size = 64


def web_application(web_root: Path, api, frontend_root: Path | None = None):
    web_root = web_root.resolve()
    frontend_root = frontend_root.resolve() if frontend_root else None

    def application(environ, start_response):
        path = environ.get("PATH_INFO", "/")
        if path.startswith("/api/"):
            return api(environ, start_response)
        if path in ("/", "/play") and (frontend_root is None or path == "/play"):
            start_response("302 Found", [("Location", "/play/"), ("Cache-Control", "no-store")])
            return [b""]
        if frontend_root is not None and not path.startswith("/play/") and environ["REQUEST_METHOD"] in ("GET", "HEAD"):
            relative = unquote(path.removeprefix("/static/") if path.startswith("/static/") else path.lstrip("/"))
            target = (frontend_root / relative).resolve()
            if not target.is_relative_to(frontend_root):
                start_response("404 Not Found", [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])
                return [b"Not found"]
            # History routes use the SPA index; missing static files stay 404.
            if not target.is_file() and not Path(relative).suffix:
                target = frontend_root / "index.html"
            if not target.is_file():
                start_response("404 Not Found", [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])
                return [b"Not found"]
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            start_response("200 OK", [("Content-Type", content_type), ("Content-Length", str(target.stat().st_size)), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")])
            if environ["REQUEST_METHOD"] == "HEAD":
                return [b""]
            return environ["wsgi.file_wrapper"](target.open("rb"), 65536)
        if not path.startswith("/play/") or environ["REQUEST_METHOD"] not in ("GET", "HEAD"):
            start_response("404 Not Found", [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])
            return [b"Not found"]
        relative = unquote(path[len("/play/"):]) or "index.html"
        target = (web_root / relative).resolve()
        if not target.is_relative_to(web_root) or not target.is_file():
            start_response("404 Not Found", [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])
            return [b"Not found"]
        content_type = {".wasm": "application/wasm", ".data": "application/octet-stream", ".js": "application/javascript"}.get(target.suffix)
        content_type = content_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        start_response("200 OK", [("Content-Type", content_type), ("Content-Length", str(target.stat().st_size)), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")])
        if environ["REQUEST_METHOD"] == "HEAD":
            return [b""]
        return environ["wsgi.file_wrapper"](target.open("rb"), 65536)

    return application


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-root", type=Path, default=Path(__file__).resolve().parents[2] / "unity/AbbyCamp/Builds/Web")
    parser.add_argument("--frontend-root", type=Path, help="Also serve a built React app for same-origin journal/Play checks")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--ready-file", type=Path)
    parser.add_argument("--stop-file", type=Path)
    parser.add_argument("--lifetime-seconds", type=float, default=1800)
    parser.add_argument("--fail-first-log", action="store_true")
    args = parser.parse_args()
    if not (args.web_root / "index.html").is_file():
        parser.error("Build the Web target first; index.html is missing.")
    if args.frontend_root and not (args.frontend_root / "index.html").is_file():
        parser.error("Build React first; frontend index.html is missing.")
    if not 0 <= args.port <= 65535 or args.lifetime_seconds <= 0:
        parser.error("Invalid port or lifetime.")
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop)
    with TemporaryDirectory(prefix="abby-web-fixture-") as temporary:
        try:
            configure_django(Path(temporary))
            fixture = seed_fixture()
            from django.core.wsgi import get_wsgi_application

            api = fixture_wsgi(get_wsgi_application(), fail_first_log=args.fail_first_log)
            with make_server("127.0.0.1", args.port, web_application(args.web_root, api, args.frontend_root), server_class=PreviewServer) as server:
                server.timeout = .25
                fixture["url"] = f"http://127.0.0.1:{server.server_port}"
                fixture["play_url"] = fixture["url"] + "/play/"
                fixture["expires_in_seconds"] = args.lifetime_seconds
                if args.ready_file:
                    args.ready_file.parent.mkdir(parents=True, exist_ok=True)
                    args.ready_file.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
                sys.stdout.write(json.dumps(fixture, indent=2) + "\n")
                sys.stdout.flush()
                deadline = time.monotonic() + args.lifetime_seconds
                while not stopping and time.monotonic() < deadline and not (args.stop_file and args.stop_file.exists()):
                    server.handle_request()
        finally:
            from django.db import connections

            connections.close_all()
            if args.ready_file:
                args.ready_file.unlink(missing_ok=True)
            if args.stop_file:
                args.stop_file.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
