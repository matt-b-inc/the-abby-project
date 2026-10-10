"""Disposable production-static server for the browser PWA release test.

Use the real Django URL configuration, production WhiteNoise middleware and
collectstatic storage. Only the API/Unity responses are synthetic; no database,
credentials, uploads, or user fixtures are read. Each process loads one release
at import time, matching replacement of the production Django container.
"""

import argparse
import json
import os
from pathlib import Path
from socketserver import ThreadingMixIn
import sys
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("release_dir", type=Path)
    parser.add_argument("port", type=int)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

    os.environ.update({
        "DEBUG": "False",
        "SECRET_KEY": "pwa-browser-test-synthetic-secret-never-used-in-production",
        "DATABASE_URL": "sqlite:///:memory:",
        "ALLOWED_HOSTS": "127.0.0.1,localhost",
        "USE_S3_STORAGE": "False",
        "DJANGO_SETTINGS_MODULE": "config.settings",
    })

    import django
    from django.conf import settings
    from django.core.management import call_command
    from django.core.wsgi import get_wsgi_application

    settings.BASE_DIR = args.release_dir.resolve()
    settings.STATIC_ROOT = settings.BASE_DIR / "staticfiles"
    settings.STATICFILES_DIRS = [settings.BASE_DIR / "frontend_dist"]
    settings.MEDIA_ROOT = settings.BASE_DIR / "media"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    django.setup()
    call_command("collectstatic", interactive=False, verbosity=0)
    django_app = get_wsgi_application()

    def application(environ, start_response):
        path = environ["PATH_INFO"]
        if path in ("/api/pwa-fixture/", "/api/chronicle/", "/api/chronicle/private-sentinel"):
            body = json.dumps({"synthetic": path}).encode()
            start_response("200 OK", [("Content-Type", "application/json"), ("Cache-Control", "no-cache")])
            return [body]
        # Production's reverse proxy serves the separately built Unity host
        # before Django. Both exact /play and /play/ must bypass the SPA SW.
        if path == "/play" or path.startswith("/play/"):
            start_response("200 OK", [("Content-Type", "text/html")])
            return [b"<!doctype html><title>Synthetic Unity host</title><h1>Synthetic Unity host</h1>"]
        if path == "/__pwa_fixture_health__":
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [b"synthetic fixture ready"]
        return django_app(environ, start_response)

    class ThreadedServer(ThreadingMixIn, WSGIServer):
        daemon_threads = True
        allow_reuse_address = True

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, format, *args):
            pass

    with make_server("127.0.0.1", args.port, application, ThreadedServer, QuietHandler) as server:
        sys.stdout.write(f"READY {server.server_port}\n")
        sys.stdout.flush()
        server.serve_forever()


if __name__ == "__main__":
    main()
