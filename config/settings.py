import os
import sys
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# DEBUG is read first so the production guards on SECRET_KEY / DATABASE_URL
# below can branch on it. Defaults to True for local convenience; production
# deploys MUST set DEBUG=False (the compose / Coolify configs already do).
DEBUG = os.environ.get("DEBUG", "True").lower() in ("true", "1", "yes")

# Audit C4: refuse to boot in production with a missing or insecure SECRET_KEY.
# Prior versions defaulted to "django-insecure-dev-key-change-me-in-production",
# so a deploy that forgot the env var would silently sign tokens / sessions
# with a known key. Local dev still gets a (clearly-marked) placeholder.
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not DEBUG and (not SECRET_KEY or SECRET_KEY.startswith("django-insecure")):
    raise ImproperlyConfigured(
        "SECRET_KEY must be set to a strong, unique value when DEBUG=False."
    )
if not SECRET_KEY:
    SECRET_KEY = "django-insecure-dev-only-DO-NOT-USE-in-production"

ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()
]

# Honor X-Forwarded-Proto from Traefik/Caddy so Django knows requests are HTTPS
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "django_celery_beat",
    "oauth2_provider",
    # Local apps — accounts first (owns AUTH_USER_MODEL)
    "apps.accounts",
    "apps.families",
    "apps.projects",
    "apps.notifications",
    "apps.ingestion",
    "apps.timecards",
    "apps.payments",
    "apps.achievements",
    "apps.portfolio",
    "apps.rewards",
    "apps.chores",
    "apps.chronicle",
    "apps.homework",
    "apps.mcp_server",
    "apps.google_integration",
    "apps.rpg",
    "apps.habits",
    "apps.pets",
    "apps.quests",
    "apps.lorebook",
    "apps.activity",
    "apps.creations",
    "apps.movement",
    "apps.wellbeing",
    "apps.printing",
    "apps.dev_tools",
]

# --- 3D printing (the Forge) ---------------------------------------------
# The listener process (``manage.py run_printer_listener``) holds EXACTLY ONE
# MQTT connection per printer. The X1's embedded broker accepts only about
# four clients total — Bambu Studio, Handy and Home Assistant each hold one —
# so nothing else in this codebase may connect. Everything else reads printer
# state through the fan-out in ``apps/printing/fanout.py``.

# Path to Bambu Lab's CA certificate (PEM). When set, the LAN transport
# verifies the printer's certificate chain against it. Hostname verification
# stays off regardless: the printer's cert CN is its SERIAL, not the IP we
# dial, so a hostname check can never pass. Leave unset to fall back to an
# unverified TLS session on the local network.
PRINT_BAMBU_CA_CERT = os.environ.get("PRINT_BAMBU_CA_CERT", "")

# Bambu Cloud broker, used when a PrinterProfile is set to the ``cloud``
# transport. Region is a property of the Bambu ACCOUNT, not the printer — a
# China-region account must point at cn.mqtt.bambulab.com.
PRINT_BAMBU_CLOUD_HOST = os.environ.get(
    "PRINT_BAMBU_CLOUD_HOST", "us.mqtt.bambulab.com",
)
PRINT_BAMBU_CLOUD_PORT = int(os.environ.get("PRINT_BAMBU_CLOUD_PORT", "8883"))

# Optional relay broker for fan-out. Point Home Assistant at THIS instead of
# at the printer and the connection-limit flapping stops. Snapshots are
# republished (retained) to ``abby/printers/<serial>/state``.
# Example: mqtt://homeassistant:secret@mosquitto:1883
PRINT_FANOUT_MQTT_URL = os.environ.get("PRINT_FANOUT_MQTT_URL", "")

# --- Web Push (VAPID) --------------------------------------------------
# Generate a keypair once and set both halves in the environment:
#   python manage.py generate_vapid_keys
# With either half missing, push is INERT — subscriptions are refused and
# notify() skips the fan-out entirely, so the app runs exactly as it did
# before push existed. The in-app bell is unaffected either way.
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
# RFC 8292 requires a contact for the push service to reach if a key
# misbehaves. Must be a mailto: or https: URL.
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:noreply@summerforge.local")

# --- Dev tools ------------------------------------------------------------
# Manual-testing helpers (``python manage.py force_drop`` etc.) are gated
# behind ``DEBUG=True`` OR ``DEV_TOOLS_ENABLED=True``. Production deploys
# ship with both False so the commands no-op (raise CommandError) on
# accidental invocation. See ``apps/dev_tools/gate.py``.
DEV_TOOLS_ENABLED = os.environ.get(
    "DEV_TOOLS_ENABLED", "False"
).lower() in ("true", "1", "yes")

# --- MCP server -----------------------------------------------------------
# Exposed via ``python manage.py runmcp`` and the ``mcp`` compose service.
# Values are read by ``apps.mcp_server.server``.
MCP_SERVER_NAME = "abby"
MCP_PUBLIC_BASE_URL = os.environ.get("MCP_PUBLIC_BASE_URL", "")
# Allow --as-user pinning only outside production.
MCP_DEV_ALLOW_USER_PIN = DEBUG

# --- OAuth 2.1 (MCP-spec auth for /mcp/*) ---------------------------------
# Both the OAuth issuer/endpoint URLs and the RFC 8707 resource indicator
# derive from ``MCP_PUBLIC_BASE_URL`` (the existing env var that points
# at the public MCP endpoint, e.g. ``https://abby.bos.lol/mcp``).
#
#   * ``SITE_URL`` — origin stripped from MCP_PUBLIC_BASE_URL; used as the
#     ``issuer`` and base for ``authorization_endpoint`` / ``token_endpoint`` /
#     ``registration_endpoint`` in the RFC 8414 metadata.
#   * ``MCP_RESOURCE_URL`` — the resource identifier itself; tokens issued via
#     the auth-code flow are bound to this exact string. The MCP auth
#     middleware refuses tokens whose ``resource`` claim doesn't match.
#
# When ``MCP_PUBLIC_BASE_URL`` isn't set (local dev), fall back to the
# runserver origin. Production MUST set it explicitly so the discovery
# JSON points MCP clients (Cowork, mcp-remote) at the public hostname.
if MCP_PUBLIC_BASE_URL:
    from urllib.parse import urlparse as _urlparse
    _mcp_resource = MCP_PUBLIC_BASE_URL.rstrip("/")
    _parsed_mcp = _urlparse(_mcp_resource)
    SITE_URL = f"{_parsed_mcp.scheme}://{_parsed_mcp.netloc}"
    MCP_RESOURCE_URL = _mcp_resource
else:
    SITE_URL = "http://localhost:8000"
    MCP_RESOURCE_URL = f"{SITE_URL}/mcp"

# Login redirect for OAuth consent flow — the AbbyAuthorizationView uses
# Django session auth for the consent screen, so unauthenticated users get
# bounced to ``/oauth/login/`` (a tiny username/password view that loops
# back to /oauth/authorize/ on success).
LOGIN_URL = "/oauth/login/"

# DNS rebinding protection for the MCP Streamable HTTP transport.
#
# The MCP SDK (>=1.9) ships ``TransportSecurityMiddleware`` which rejects any
# request whose ``Host`` header is not in ``allowed_hosts`` (returns HTTP 421
# "Misdirected Request"). If no ``transport_security`` is passed to
# ``FastMCP(...)``, the SDK auto-enables protection with loopback-only hosts,
# which breaks every request reaching the server through a reverse proxy.
#
# ``MCP_ALLOWED_HOSTS`` / ``MCP_ALLOWED_ORIGINS`` accept a comma-separated
# env override. When unset, we derive sensible defaults from Django's
# ``ALLOWED_HOSTS`` + ``CSRF_TRUSTED_ORIGINS`` so a site whose public
# hostname is already listed there "just works" without a second env var.
# Setting either value to ``*`` disables DNS rebinding protection entirely
# (escape hatch — not recommended for production).
def _expand_mcp_host(host: str) -> list[str]:
    """Return ``[host, host:*]`` — matches both default-port and any-port."""
    host = host.strip()
    # Django wildcards like ``.sslip.io`` and ``*`` can't be expressed in the
    # MCP SDK's simple host match, so skip them. Operators who need those
    # should set ``MCP_ALLOWED_HOSTS`` explicitly.
    if not host or host == "*" or host.startswith("."):
        return []
    if ":" in host:
        return [host]
    return [host, f"{host}:*"]


_mcp_allowed_hosts_env = os.environ.get("MCP_ALLOWED_HOSTS", "").strip()
if _mcp_allowed_hosts_env:
    MCP_ALLOWED_HOSTS = [
        h.strip() for h in _mcp_allowed_hosts_env.split(",") if h.strip()
    ]
else:
    MCP_ALLOWED_HOSTS = [
        "127.0.0.1",
        "127.0.0.1:*",
        "localhost",
        "localhost:*",
        "[::1]",
        "[::1]:*",
    ]
    for _h in ALLOWED_HOSTS:
        for _entry in _expand_mcp_host(_h):
            if _entry not in MCP_ALLOWED_HOSTS:
                MCP_ALLOWED_HOSTS.append(_entry)

_mcp_allowed_origins_env = os.environ.get("MCP_ALLOWED_ORIGINS", "").strip()
if _mcp_allowed_origins_env:
    MCP_ALLOWED_ORIGINS = [
        o.strip() for o in _mcp_allowed_origins_env.split(",") if o.strip()
    ]
else:
    MCP_ALLOWED_ORIGINS = [
        "http://127.0.0.1",
        "http://127.0.0.1:*",
        "http://localhost",
        "http://localhost:*",
        "http://[::1]",
        "http://[::1]:*",
    ]
    for _h in ALLOWED_HOSTS:
        for _entry in _expand_mcp_host(_h):
            for _scheme in ("http", "https"):
                _origin = f"{_scheme}://{_entry}"
                if _origin not in MCP_ALLOWED_ORIGINS:
                    MCP_ALLOWED_ORIGINS.append(_origin)
    # Preserve any explicit CSRF_TRUSTED_ORIGINS (they already include scheme).
    for _origin in CSRF_TRUSTED_ORIGINS:
        if _origin and _origin not in MCP_ALLOWED_ORIGINS:
            MCP_ALLOWED_ORIGINS.append(_origin)

# --- Rewards / Coins economy ----------------------------------------------
# How many Coins a child earns per hour of tracked time.
COINS_PER_HOUR = 5
# Per-rarity coin bonus when a Badge is earned.
COINS_PER_BADGE_RARITY = {
    "common": 5,
    "uncommon": 15,
    "rare": 35,
    "epic": 75,
    "legendary": 150,
}
# How many Coins a child receives per $1.00 exchanged (money → coins).
COINS_PER_DOLLAR = 10
# Coins granted on a child's birthday, multiplied by age in years (tunable).
BIRTHDAY_COINS_PER_YEAR = 100

# --- Homework timeliness ----------------------------------------------------
# Homework pays no money and no coins — rewards are XP, drops, streaks, and
# quest progress only. The label from ``HomeworkService.get_timeliness`` is
# recorded on each submission and gates the "on_time" quest filter; past
# this many days late the submission flips to ``beyond_cutoff`` instead of
# ``late`` so badges and UI can show the right state.
HOMEWORK_LATE_CUTOFF_DAYS = 3

# --- Homework planning self-serve gate -------------------------------------
# Children can self-trigger ``POST /api/homework/{id}/plan/`` on their own
# assignments only when the due date is at least this many days out. Parents
# always can, regardless of due date. Default 3 — tuned so "planning ahead"
# earns autonomy while panic-mode still requires a parent conversation.
HOMEWORK_SELF_PLAN_LEAD_DAYS = 3

# --- Text LLM (ingestion enrich, project suggestions, homework planning) --
# All three call sites route through ``config.llm.complete_json``. The
# active backend is picked by ``LLM_BACKEND`` (auto|anthropic|ollama|none).
# ``auto`` (default) prefers Anthropic when a key is set, then Ollama when a
# base URL is set, then falls back to the non-AI path each call site already
# ships. Settings should always be read via ``django.conf.settings`` — never
# re-read os.environ in app code.
LLM_BACKEND = os.environ.get("LLM_BACKEND", "auto")

# Anthropic (hosted Claude)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

# Ollama (local LAN). Empty base URL disables the backend.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:latest")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "120"))

# --- Google Gemini (sprite generation) ------------------------------------
# Optional. When set, enables the ``generate_sprite_sheet`` MCP tool which
# calls Gemini 3 Pro Image ("Nano Banana Pro") to produce pixel-art sprite
# sheets from a text prompt. Empty disables the tool (raises at call time).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3-pro-image-preview")
# Hard cap on per-call frame count — bounds worst-case API spend per
# invocation (each frame is one image-generation call).
SPRITE_GENERATION_MAX_FRAMES = 8

# --- Google OAuth / Calendar ------------------------------------------------
# Optional. When set, enables "Sign in with Google" and Google Calendar sync.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")

MIDDLEWARE = [
    "config.middleware.HealthCheckMiddleware",
    "config.middleware.NoCacheAPIMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "config.middleware.SentryUserMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Project-level templates dir is searched BEFORE app-shipped templates,
        # so files under templates/oauth2_provider/ override DOT defaults.
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database
#
# Audit H12: refuse to boot in production with no DATABASE_URL. The prior
# default fell through to ``sqlite:///db.sqlite3`` inside the ephemeral
# container filesystem — migrations would succeed, traffic would serve, and
# the next deploy would wipe everything. Local dev still falls through to
# SQLite for zero-config development.
_db_url = os.environ.get("DATABASE_URL", "")
if not DEBUG and not _db_url:
    raise ImproperlyConfigured(
        "DATABASE_URL is required when DEBUG=False (refusing to fall back to SQLite)."
    )
DATABASES = {
    "default": dj_database_url.parse(
        _db_url or "sqlite:///db.sqlite3",
        # Recycle persistent connections every 60s (down from 600s) so stale
        # slots free up faster — load-bearing for surviving Coolify deploy
        # overlap and brief Postgres blips without exhausting max_connections.
        conn_max_age=60,
        # Run a cheap SELECT 1 before reusing a persistent connection so dead
        # connections (after a DB restart / network blip) get replaced
        # cleanly instead of failing inside a real query.
        conn_health_checks=True,
    )
}

# Password validation

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Internationalization

LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/Phoenix"
USE_I18N = True
USE_TZ = True

# Static files
#
# The React bundle is built into /app/frontend_dist by the Docker build
# and picked up here so collectstatic copies it into STATIC_ROOT. Vite
# already content-hashes filenames, so we use CompressedStaticFilesStorage
# (no Manifest layer) — WhiteNoise gzips/brotlis at collectstatic time and
# serves Vite's original hashed filenames directly.

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "frontend_dist"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    # Sprites: dedicated public-read bucket on Ceph with long-lived Cache-Control
    # headers so browsers cache aggressively and no presigning is needed.
    # Defaults to FileSystemStorage in dev/test; flips to S3 when USE_S3_STORAGE=true.
    "sprites": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
}

# Media files
#
# Default: local FileSystemStorage at MEDIA_ROOT, served by config/urls.py.
# Production: set USE_S3_STORAGE=true to route every FileField/ImageField
# through django-storages' S3 backend pointed at MinIO (s3.neato.digital).
# When S3 is on, MEDIA_URL/MEDIA_ROOT are ignored and image URLs returned
# in API responses are presigned (signed with AWS_ACCESS_KEY_ID, expire
# after AWS_QUERYSTRING_EXPIRE seconds).

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

USE_S3_STORAGE = os.environ.get("USE_S3_STORAGE", "False").lower() in (
    "true",
    "1",
    "yes",
)

if USE_S3_STORAGE:
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL", "")
    AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME", "")
    AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    # boto3 requires a region even when MinIO ignores it.
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "us-east-1")
    # MinIO needs path-style addressing (bucket-as-subdomain doesn't work
    # against most self-hosted S3-compatible servers behind a reverse proxy).
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_S3_SIGNATURE_VERSION = "s3v4"
    # Presigned URLs — bucket is private, every read goes through a signed URL.
    AWS_QUERYSTRING_AUTH = True
    AWS_QUERYSTRING_EXPIRE = int(os.environ.get("AWS_QUERYSTRING_EXPIRE", "3600"))
    # Don't overwrite same-named uploads — django-storages appends a random
    # suffix (e.g. cover_aB12cD.jpg) so two kids uploading "cover.jpg" stay
    # distinct. Mirrors the FileSystemStorage default behavior.
    AWS_S3_FILE_OVERWRITE = False
    # MinIO doesn't honor canned ACLs the same way AWS does; leave unset.
    AWS_DEFAULT_ACL = None
    # Optional: split the boto3 endpoint (used for write/delete/copy API
    # calls) from the URL hostname (used for emitted media URLs). Needed
    # when the Django container and Ceph live on the same network behind
    # the same Cloudflare zone — the container can't reach the public
    # hostname (Cloudflare hairpin returns 521) but CAN reach an internal
    # service hostname. Set AWS_S3_ENDPOINT_URL to the internal endpoint
    # (e.g. ``http://ceph-internal:7480``) and AWS_S3_CUSTOM_DOMAIN to the
    # public hostname (``s3.neato.digital``) so the URLs the API emits to
    # the browser still hit Cloudflare. Empty (default) keeps the existing
    # single-endpoint behaviour — django-storages derives URLs from the
    # endpoint_url verbatim.
    AWS_S3_CUSTOM_DOMAIN = os.environ.get("AWS_S3_CUSTOM_DOMAIN", "") or None

    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage"}

    # Sprite bucket — public-read, immutable cache, no presigning.
    STORAGES["sprites"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": os.environ.get("SPRITE_S3_BUCKET", "abby-sprites"),
            # AWS_S3_ENDPOINT_URL is defined earlier in this USE_S3_STORAGE block.
            "endpoint_url": os.environ.get(
                "SPRITE_S3_ENDPOINT", AWS_S3_ENDPOINT_URL,
            ),
            "access_key": AWS_ACCESS_KEY_ID,
            "secret_key": AWS_SECRET_ACCESS_KEY,
            "region_name": AWS_S3_REGION_NAME,
            "addressing_style": "path",
            "signature_version": "s3v4",
            "querystring_auth": False,   # public URLs, no presigning
            "default_acl": "public-read",
            # intentional: True is safe because every write path goes through
            # apps/rpg/sprite_authoring.py which names files as <slug>-<sha256[:8]>.png.
            # Different bytes → different hash → different file (no collision).
            # Identical bytes → same hash → same file (overwrite is a no-op).
            "file_overwrite": True,
            "object_parameters": {
                "CacheControl": "public, max-age=31536000, immutable",
            },
            "custom_domain": os.environ.get("SPRITE_S3_CUSTOM_DOMAIN") or None,
        },
    }

# Allow larger bodies for PDF ingestion and photo uploads now that gunicorn
# handles uploads directly (no nginx in front).
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25 MB

# Default primary key field type

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Custom user model

AUTH_USER_MODEL = "accounts.User"

# Django REST Framework

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # Per-IP throttles. Endpoints opt in via
    # ``throttle_classes = [ScopedRateThrottle]`` + ``throttle_scope``.
    #
    #   signup — parent self-signup: ALLOW_PARENT_SIGNUP creates a Family +
    #   founding parent + auth token. 5/hour caps drive-by spam.
    #
    #   login — audit C5. Caps unauthenticated brute-force at 10/min per IP.
    #   Tuned conservatively: a fat-fingering household sees the limit only
    #   after 10 wrong passwords in a minute. Pair with a per-username
    #   AnonRateThrottle if IP rotation becomes a concern.
    "DEFAULT_THROTTLE_RATES": {
        "signup": "5/hour",
        "login": "10/min",
        # Dynamic Client Registration (RFC 7591) — public, no auth required,
        # so a bare per-IP cap is the guardrail against drive-by spam.
        "oauth_register": "10/hour",
    },
}

# Swappable model defaults (DOT expects these to be set at the Django
# settings level so foreign keys to its tables resolve at migration time).
# We don't swap any of them — the defaults are what we want — but Django's
# autodetector raises AttributeError if they're absent before app.ready().
OAUTH2_PROVIDER_APPLICATION_MODEL = "oauth2_provider.Application"
OAUTH2_PROVIDER_ACCESS_TOKEN_MODEL = "oauth2_provider.AccessToken"
OAUTH2_PROVIDER_ID_TOKEN_MODEL = "oauth2_provider.IDToken"
OAUTH2_PROVIDER_GRANT_MODEL = "oauth2_provider.Grant"
OAUTH2_PROVIDER_REFRESH_TOKEN_MODEL = "oauth2_provider.RefreshToken"

# django-oauth-toolkit (DOT) — MCP-spec OAuth 2.1 provider.
#
# Public-clients-only + PKCE-required is enforced by ``AbbyOAuth2Validator``
# on top of these settings (DOT itself accepts secret-bearing clients when
# PKCE_REQUIRED is True, so the validator override is what actually blocks
# the confidential-client paths).
#
# RFC 8707 ``resource`` parameter binding lives on the validator's
# ``save_authorization_code`` / ``save_bearer_token`` hooks.
OAUTH2_PROVIDER = {
    "OAUTH2_VALIDATOR_CLASS": "config.oauth_validator.AbbyOAuth2Validator",
    "PKCE_REQUIRED": True,
    "ACCESS_TOKEN_EXPIRE_SECONDS": 3600,                  # 1 hour
    "REFRESH_TOKEN_EXPIRE_SECONDS": 60 * 60 * 24 * 30,    # 30 days
    "ROTATE_REFRESH_TOKEN": True,
    "SCOPES": {
        "mcp": "Access the Abby MCP server on your behalf",
    },
    "DEFAULT_SCOPES": ["mcp"],
    "REQUEST_APPROVAL_PROMPT": "auto",   # skip consent screen on re-auth
    "ALLOWED_REDIRECT_URI_SCHEMES": ["https", "http"],  # http for localhost only
    "OIDC_ENABLED": False,
    # Allow the wildcard ``*`` access scope claim from RFC 9728 metadata to
    # round-trip; we only define ``mcp`` for now but DOT requires the dict.
}

# Parent self-signup creates a new Family + founding parent. Set to "false"
# to disable signup at deploy time (e.g. closed-beta deployments).
ALLOW_PARENT_SIGNUP = (
    os.environ.get("ALLOW_PARENT_SIGNUP", "True").lower() in ("true", "1", "yes")
)

# CORS
#
# In production the React bundle is served by Django from the same origin as
# the API, so no cross-origin requests happen. These defaults exist only for
# the local Vite dev server (npm run dev at :3000 / :5173) which proxies /api
# to the Django dev server on :8000.

CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
).split(",")
CORS_ALLOW_CREDENTIALS = True

# Cache (Redis)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    }
}

# Celery

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

from celery.schedules import crontab  # noqa: E402

CELERY_BEAT_SCHEDULE = {
    "auto-clock-out": {
        "task": "apps.timecards.tasks.auto_clock_out_task",
        "schedule": crontab(minute="*/30"),
    },
    "weekly-timecards": {
        "task": "apps.timecards.tasks.generate_weekly_timecards_task",
        # Sunday 23:55 local — runs at the end of the just-finished week.
        "schedule": crontab(hour=23, minute=55, day_of_week="sun"),
    },
    "weekly-email-summaries": {
        "task": "apps.timecards.tasks.send_weekly_email_summaries",
        "schedule": crontab(hour=8, minute=0, day_of_week="sun"),
    },
    "daily-reminders": {
        "task": "apps.google_integration.tasks.send_daily_reminders_task",
        # 7:00 AM daily — just after quiet hours end.
        "schedule": crontab(hour=7, minute=0),
    },
    "rpg-perfect-day": {
        "task": "apps.rpg.tasks.evaluate_perfect_day_task",
        "schedule": crontab(hour=23, minute=55),
    },
    "rpg-streak-at-risk": {
        "task": "apps.rpg.tasks.streak_at_risk_warning_task",
        # 19:00 local — early enough that the kid still has an evening
        # to save the streak before the 23:55 perfect-day tick.
        "schedule": crontab(hour=19, minute=0),
    },
    "habit-decay": {
        "task": "apps.habits.tasks.decay_habit_strength_task",
        "schedule": crontab(hour=0, minute=5),
    },
    "quest-expire": {
        "task": "apps.quests.tasks.expire_quests_task",
        "schedule": crontab(hour=0, minute=10),
    },
    "quest-boss-rage": {
        "task": "apps.quests.tasks.apply_boss_rage_task",
        "schedule": crontab(hour=0, minute=15),
    },
    "chronicle-birthday-check": {
        "task": "apps.chronicle.tasks.chronicle_birthday_check",
        "schedule": crontab(hour=0, minute=20),
    },
    "chronicle-chapter-transition": {
        "task": "apps.chronicle.tasks.chronicle_chapter_transition",
        "schedule": crontab(hour=0, minute=25),
    },
    "daily-challenge-rotation": {
        "task": "apps.quests.tasks.rotate_daily_challenges_task",
        "schedule": crontab(hour=0, minute=30),
    },
    "print-reconcile-stale-jobs": {
        "task": "apps.printing.tasks.reconcile_stale_jobs",
        # 00:35 — next free slot in the staggered daily-housekeeping run.
        # Backstop for a printer that vanished mid-print (power cut), which
        # never sends the gcode_state transition the listener closes jobs on.
        "schedule": crontab(hour=0, minute=35),
    },
}

# Session

SESSION_ENGINE = "django.contrib.sessions.backends.cache"
SESSION_CACHE_ALIAS = "default"

# Email
#
# Audit H11: prior versions hardcoded the console backend, so the Sunday
# 08:00 weekly-summary email task wrote into ``docker logs`` in production
# instead of reaching parents. Now reads from env; defaults to console only
# when DEBUG=True so local dev keeps zero-config behaviour.
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@summerforge.local")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "True").lower() in ("true", "1", "yes")

# ──────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────
LOG_JSON = os.environ.get("LOG_JSON", "").lower() in ("1", "true", "yes")
_DEFAULT_FORMATTER = "json" if LOG_JSON else "verbose"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
        "json": {
            "()": "config.logging.JsonFormatter",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": _DEFAULT_FORMATTER,
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "apps": {
            "handlers": ["console"],
            "level": "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
    },
}

# ──────────────────────────────────────────────────────────────────────────
# Sentry error tracking
# ──────────────────────────────────────────────────────────────────────────
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = os.environ.get(
    "SENTRY_ENVIRONMENT", "development" if DEBUG else "production"
)
SENTRY_TRACES_SAMPLE_RATE = float(
    os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.2")
)

if SENTRY_DSN:
    import logging as _logging

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        # Audit H10: ``send_default_pii=True`` attaches IPs, request headers
        # (incl. Authorization), cookies, and request bodies to every Sentry
        # event — far more than this app's userbase (which includes minors)
        # should be sending to a self-hosted Sentry. ``SentryUserMiddleware``
        # already attaches the user fields we actually want; keep it explicit.
        send_default_pii=False,
        release=os.environ.get("SENTRY_RELEASE", None),
        integrations=[
            DjangoIntegration(),
            CeleryIntegration(),
            LoggingIntegration(
                level=_logging.WARNING,
                event_level=_logging.ERROR,
            ),
            RedisIntegration(),
        ],
    )

# ──────────────────────────────────────────────────────────────────────────
# Testing — use syncdb for fast model/API test databases.
#
# Fresh installs are repaired by projects.0001_initial_with_accounts_bootstrap.
# The focused accounts migration regressions run the real graph in isolated
# processes, without this shortcut, and verify existing migration records.
# Keep ordinary model/API tests using current state for faster setup.
# ──────────────────────────────────────────────────────────────────────────
if "test" in sys.argv:
    MIGRATION_MODULES = {app.split(".")[-1]: None for app in INSTALLED_APPS}
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    # Tests use SimpleUploadedFile against a local temp dir — never reach for
    # MinIO even when USE_S3_STORAGE is set in the developer's shell env.
    USE_S3_STORAGE = False
    STORAGES["default"] = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    STORAGES["sprites"] = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
