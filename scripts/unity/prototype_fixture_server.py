#!/usr/bin/env python
"""Run real Django APIs against disposable, local-only Unity smoke fixtures.

    python scripts/unity/prototype_fixture_server.py --port 0 --ready-file ready.json
    python scripts/unity/prototype_fixture_server.py --check

Requires the project's Python dependencies. The script does not load .env or
open the project's database. Ctrl+C removes the temporary database and media.
All printed credentials belong only to this throwaway test server.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sys
from tempfile import TemporaryDirectory
import time
from types import SimpleNamespace
from urllib.parse import urlsplit
from wsgiref.simple_server import make_server


USERNAME = "camp-smoke"
PASSWORD = "only-local-smoke"
PARENT_USERNAME = "camp-parent"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def configure_django(temporary_root: Path) -> None:
    """Configure isolation before importing models, middleware, or settings."""
    sys.path.insert(0, str(REPOSITORY_ROOT))
    from django.conf import settings

    if settings.configured:
        raise RuntimeError("Run the fixture harness in a fresh Python process.")

    prefixes = (
        "AWS_", "GOOGLE_", "VAPID_", "SENTRY_", "PRINT_", "ANTHROPIC_",
        "GEMINI_", "OLLAMA_", "OPENAI_", "CELERY_", "REDIS_", "EMAIL_",
    )
    for name in list(os.environ):
        if name.startswith(prefixes) or name.endswith(("_API_KEY", "_SECRET", "_TOKEN")):
            os.environ.pop(name, None)
    os.environ.update({
        "DJANGO_SETTINGS_MODULE": "config.settings_test",
        "DATABASE_URL": "sqlite:///:memory:",
        "DEBUG": "True",
        "SECRET_KEY": secrets.token_urlsafe(48),
        "ALLOWED_HOSTS": "127.0.0.1,localhost,testserver",
        "USE_S3_STORAGE": "False",
        "SENTRY_DSN": "",
        "LLM_BACKEND": "none",
        "ANTHROPIC_API_KEY": "",
        "GEMINI_API_KEY": "",
        "GOOGLE_CLIENT_ID": "",
        "GOOGLE_CLIENT_SECRET": "",
        "OLLAMA_BASE_URL": "",
        "VAPID_PUBLIC_KEY": "",
        "VAPID_PRIVATE_KEY": "",
        "PRINT_FANOUT_MQTT_URL": "",
    })

    fixture_settings = importlib.import_module("config.settings_test")
    fixture_settings.DATABASES = {"default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(temporary_root / "fixture.sqlite3"),
        "CONN_MAX_AGE": 0,
        "OPTIONS": {"timeout": 20},
    }}
    # Fresh test databases use current models, matching settings.py's test
    # mode. The historical user-model move prevents fresh normal migrations.
    fixture_settings.MIGRATION_MODULES = {
        app.split(".")[-1]: None for app in fixture_settings.INSTALLED_APPS
    }
    fixture_settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    fixture_settings.MEDIA_ROOT = temporary_root / "media"
    fixture_settings.STATIC_ROOT = temporary_root / "static"
    fixture_settings.USE_S3_STORAGE = False
    fixture_settings.STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "sprites": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    fixture_settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    fixture_settings.REST_FRAMEWORK = {**fixture_settings.REST_FRAMEWORK, "PAGE_SIZE": 2}
    fixture_settings.LOGGING["root"]["level"] = "WARNING"
    fixture_settings.LOGGING["loggers"]["apps"]["level"] = "WARNING"

    import django

    django.setup()
    from django.core.management import call_command

    call_command("migrate", run_syncdb=True, verbosity=0, interactive=False)


def seed_fixture() -> dict:
    from apps.accounts.models import User
    from apps.achievements.models import Skill, SkillCategory, SkillProgress
    from apps.families.models import Family
    from apps.habits.models import Habit, HabitLog, HabitSkillTag

    family = Family.objects.create(name="Unity Test Family", slug="unity-test-family")
    parent = User.objects.create_user(
        username=PARENT_USERNAME, password=PASSWORD, role="parent",
        display_name="Camp Test Parent", family=family,
    )
    family.primary_parent = parent
    family.save(update_fields=["primary_parent"])
    child = User.objects.create_user(
        username=USERNAME, password=PASSWORD, role="child",
        display_name="Camp Explorer", family=family,
    )
    other_family = Family.objects.create(name="Other Test Family", slug="other-test-family")
    other_child = User.objects.create_user(
        username="camp-other", password=PASSWORD, role="child", family=other_family,
    )

    def habit(name: str, **kwargs):
        return Habit.objects.create(name=name, user=child, created_by=parent, **kwargs)

    available = habit("Read 10 minutes", xp_reward=10, max_taps_per_day=1)
    capped = habit("Daily stretch", xp_reward=5, max_taps_per_day=1, strength=1)
    HabitLog.objects.create(habit=capped, user=child, direction=1)
    negative = habit("Skipping bedtime", habit_type="negative", xp_reward=0)
    pending = Habit.objects.create(
        name="Pending new ritual", user=child, created_by=child,
        pending_parent_review=True,
    )
    inactive = habit("Archived ritual", is_active=False)
    foreign = Habit.objects.create(
        name="Foreign family ritual", user=other_child, created_by=other_child,
    )
    category = SkillCategory.objects.create(name="Prototype Life Skills")
    skill = Skill.objects.create(name="Reading", category=category)
    # The shared journal/meadow preview exercises actual journal XP receipts,
    # which resolve these same writing skills in the production catalog.
    language_arts = SkillCategory.objects.create(name="Language Arts")
    Skill.objects.create(name="Creative Writing", category=language_arts)
    Skill.objects.create(name="Vocabulary", category=language_arts)
    HabitSkillTag.objects.create(habit=available, skill=skill, xp_weight=1)
    SkillProgress.objects.create(user=child, skill=skill, xp_points=95, level=0)
    return {
        "username": USERNAME, "password": PASSWORD, "user_id": child.pk,
        "parent_username": PARENT_USERNAME, "parent_password": PASSWORD,
        "habits": {
            "available": available.pk, "capped": capped.pk, "negative": negative.pk,
            "pending": pending.pk, "inactive": inactive.pk, "foreign": foreign.pk,
        },
        "skill_id": skill.pk, "initial_skill_xp": 95, "available_xp_reward": 10,
    }


def fixture_wsgi(application, *, fail_first_log: bool = False):
    """Optionally reject one log at the transport boundary before Django."""
    failure_pending = fail_first_log

    def wrapped(environ, start_response):
        nonlocal failure_pending
        if (
            failure_pending
            and environ.get("REQUEST_METHOD") == "POST"
            and re.fullmatch(r"/api/habits/[0-9]+/log/", environ.get("PATH_INFO", ""))
        ):
            failure_pending = False
            body = json.dumps({"error": "Temporary test transport failure. Refresh before retrying."}).encode()
            start_response("503 Service Unavailable", [
                ("Content-Type", "application/json"), ("Content-Length", str(len(body))),
            ])
            return [body]
        return application(environ, start_response)

    return wrapped


def check_fixture(fixture: dict, *, fail_first_log: bool = False) -> None:
    """Exercise real view/serializer/award paths on the isolated database."""
    from apps.achievements.models import SkillProgress
    from django.core.wsgi import get_wsgi_application
    from django.test import RequestFactory
    from rest_framework.test import APIClient

    client = APIClient()
    current_token = ""
    application = fixture_wsgi(get_wsgi_application(), fail_first_log=fail_first_log)

    def login(username: str):
        nonlocal current_token
        response = client.post("/api/auth/", {
            "action": "login", "username": username, "password": PASSWORD,
        }, format="json")
        assert response.status_code == 200, response.content
        current_token = response.data["token"]
        client.credentials(HTTP_AUTHORIZATION=f"Token {current_token}")

    def log_request(key: str, *, pending: bool = False):
        path = f"/api/habits/{fixture['habits'][key]}/log/" + ("?pending=true" if pending else "")
        request = RequestFactory().post(
            path, json.dumps({"direction": 1}), content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {current_token}",
        )
        statuses = []

        def start_response(status, _headers, _exc_info=None):
            statuses.append(int(status.split()[0]))

        response = application(request.environ, start_response)
        try:
            content = b"".join(response)
        finally:
            if hasattr(response, "close"):
                response.close()
        return SimpleNamespace(status_code=statuses[0], content=content, data=json.loads(content))

    def collect_rows(path: str):
        rows = []
        visited = set()
        while path:
            assert path not in visited, "Pagination cycle"
            visited.add(path)
            response = client.get(path)
            assert response.status_code == 200, response.content
            page = response.json()
            rows.extend(page["results"])
            next_url = page["next"]
            if not next_url:
                break
            parsed = urlsplit(next_url)
            assert parsed.netloc in ("", "testserver"), "Unexpected pagination origin"
            path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        return rows

    login(USERNAME)
    first_page = client.get("/api/habits/").json()
    assert len(first_page["results"]) == 2 and first_page["next"]
    rows = collect_rows("/api/habits/")
    ids = {row["id"] for row in rows}
    assert fixture["habits"]["available"] in ids
    assert fixture["habits"]["capped"] in ids
    assert fixture["habits"]["negative"] in ids
    assert fixture["habits"]["pending"] not in ids
    assert fixture["habits"]["foreign"] not in ids
    character = client.get("/api/character/")
    assert character.status_code == 200, character.content

    if fail_first_log:
        failed = log_request("available")
        assert failed.status_code == 503 and "error" in failed.data, failed.content
        unchanged_rows = collect_rows("/api/habits/")
        unchanged = next(row for row in unchanged_rows if row["id"] == fixture["habits"]["available"])
        assert unchanged["strength"] == 0 and unchanged["taps_today"] == 0
        progress = SkillProgress.objects.get(user_id=fixture["user_id"], skill_id=fixture["skill_id"])
        assert progress.xp_points == 95 and progress.level == 0

    for key, expected_status in [("capped", 400), ("negative", 400), ("foreign", 404)]:
        response = log_request(key)
        assert response.status_code == expected_status, response.content
    pending = log_request("pending", pending=True)
    assert pending.status_code == 400, pending.content
    result = log_request("available")
    assert result.status_code == 200, result.content
    assert result.data["direction"] == 1
    assert result.data["xp_reward"] == 10
    assert result.data["new_strength"] == 1
    assert isinstance(result.data["game_event"], dict), result.content
    progress = SkillProgress.objects.get(user_id=fixture["user_id"], skill_id=fixture["skill_id"])
    assert progress.xp_points == 105 and progress.level == 1
    rows = collect_rows("/api/habits/")
    available = next(row for row in rows if row["id"] == fixture["habits"]["available"])
    assert available["taps_today"] == 1 and available["strength"] == 1
    memory = {"summary": "Synthetic private preview memory.", "client_entry_id": "40f149c3-83ca-428d-a48f-5dca68bf90b9"}
    saved = client.post("/api/chronicle/journal/", memory, format="json")
    assert saved.status_code == 201, saved.content
    assert saved.data["is_private"] is True
    assert saved.data["reward_receipt"]["xp_awarded"] == 15, saved.content
    meadow = client.get("/api/chronicle/meadow/").json()
    assert meadow["keepsake_count"] == 1 and meadow["journal_xp_awarded"] == 15
    assert memory["summary"] not in json.dumps(meadow)
    replay = client.post("/api/chronicle/journal/", memory, format="json")
    assert replay.status_code == 200, replay.content
    assert client.get("/api/chronicle/meadow/").json() == meadow
    login(PARENT_USERNAME)
    parent_rows = collect_rows("/api/habits/")
    assert fixture["habits"]["foreign"] not in {row["id"] for row in parent_rows}
    assert client.get("/api/chronicle/meadow/").status_code == 403
    sys.stdout.write("Fixture checks passed: auth, pagination, scoped lists, caps, approval, skill XP, journal privacy, receipt replay, persistence.\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0, help="Loopback port; 0 chooses a free port.")
    parser.add_argument("--ready-file", type=Path, help="Write URL, test credentials, and fixture IDs as JSON.")
    parser.add_argument("--stop-file", type=Path, help="Stop when this sentinel file exists; remove it on exit.")
    parser.add_argument(
        "--fail-first-log", action="store_true",
        help="Return one fixture HTTP503 before Django receives the first habit-log POST.",
    )
    parser.add_argument("--check", action="store_true", help="Check fixtures through actual Django views and exit.")
    parser.add_argument("--lifetime-seconds", type=float, default=1800, help="Auto-stop after this many seconds.")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or args.lifetime_seconds <= 0:
        parser.error("port must be 0..65535 and lifetime-seconds must be positive")

    stopping = False
    ready_written = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop)

    with TemporaryDirectory(prefix="abby-unity-fixture-") as temporary:
        try:
            configure_django(Path(temporary))
            fixture = seed_fixture()
            fixture["fail_first_log"] = args.fail_first_log
            if args.check:
                check_fixture(fixture, fail_first_log=args.fail_first_log)
                return 0
            from django.core.wsgi import get_wsgi_application

            application = fixture_wsgi(get_wsgi_application(), fail_first_log=args.fail_first_log)
            with make_server("127.0.0.1", args.port, application) as server:
                server.timeout = 0.25
                fixture["url"] = f"http://127.0.0.1:{server.server_port}"
                fixture["expires_in_seconds"] = args.lifetime_seconds
                ready_json = json.dumps(fixture, indent=2)
                if args.ready_file:
                    args.ready_file.parent.mkdir(parents=True, exist_ok=True)
                    pending_file = args.ready_file.with_name(args.ready_file.name + ".pending")
                    pending_file.write_text(ready_json + "\n", encoding="utf-8")
                    pending_file.replace(args.ready_file)
                    ready_written = True
                sys.stdout.write(ready_json + "\n")
                sys.stdout.flush()
                deadline = time.monotonic() + args.lifetime_seconds
                while (
                    not stopping
                    and time.monotonic() < deadline
                    and not (args.stop_file and args.stop_file.exists())
                ):
                    server.handle_request()
            return 0
        finally:
            from django.db import connections

            connections.close_all()
            if ready_written and args.ready_file.exists():
                args.ready_file.unlink()
            if args.stop_file and args.stop_file.exists():
                args.stop_file.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
