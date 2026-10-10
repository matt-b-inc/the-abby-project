import hashlib
import re

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve as static_serve

from config.oauth_views import (
    AbbyAuthorizationView,
    AdminApplicationListView,
    AdminApplicationRevokeTokensView,
    AdminTokenListView,
    AdminTokenRevokeView,
    DynamicClientRegistrationView,
    OAuthLoginView,
    WellKnownAuthorizationServerView,
    WellKnownProtectedResourceView,
)

# Load the built SPA entry point once at import time. In production the
# Docker build copies frontend/dist into BASE_DIR/frontend_dist. In local
# dev (python manage.py runserver) the file won't exist — React is served
# by `npm run dev` on :3000, which proxies /api here. We fall back to a
# short hint page so runserver doesn't crash.
_index_path = settings.BASE_DIR / "frontend_dist" / "index.html"
try:
    _INDEX_HTML = _index_path.read_text(encoding="utf-8")
except FileNotFoundError:
    _INDEX_HTML = (
        "<!doctype html><meta charset='utf-8'><title>Abby (dev)</title>"
        "<p>React bundle not built. Run <code>cd frontend &amp;&amp; npm run dev</code> "
        "and visit <a href='http://localhost:3000'>http://localhost:3000</a>.</p>"
    )

# Content-based ETag computed once at import time. Changes automatically on
# each redeployment (new Vite build → new asset hashes in the HTML → new ETag).
_INDEX_HTML_ETAG = hashlib.md5(_INDEX_HTML.encode()).hexdigest()


def spa_view(request):
    """Serve the built React index.html for any non-API, non-admin route."""
    # Return 304 if the browser already has the current version.
    if request.META.get("HTTP_IF_NONE_MATCH") == _INDEX_HTML_ETAG:
        return HttpResponse(status=304)
    response = HttpResponse(_INDEX_HTML, content_type="text/html; charset=utf-8")
    # Force revalidation so browsers never serve a stale index.html whose
    # hashed asset references (CSS/JS) no longer exist after a redeploy.
    response["Cache-Control"] = "no-cache"
    response["ETag"] = _INDEX_HTML_ETAG
    return response


urlpatterns = [
    path("admin/", admin.site.urls),
    # Ingestion urls must come BEFORE projects/ so /api/projects/ingest/
    # matches the ingest router first — otherwise `ingest` is interpreted as
    # a project pk by the projects viewset.
    # Accounts urls (signup) MUST come before projects/ so /api/auth/signup/
    # is matched as a literal path, not consumed by the AuthView's URL.
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.families.urls")),
    path("api/", include("apps.ingestion.urls")),
    path("api/", include("apps.projects.urls")),
    path("api/", include("apps.notifications.urls")),
    path("api/", include("apps.timecards.urls")),
    path("api/", include("apps.payments.urls")),
    path("api/", include("apps.achievements.urls")),
    path("api/", include("apps.portfolio.urls")),
    path("api/", include("apps.rewards.urls")),
    path("api/", include("apps.chores.urls")),
    path("api/", include("apps.homework.urls")),
    path("api/", include("apps.rpg.urls")),
    path("api/", include("apps.habits.urls")),
    path("api/", include("apps.pets.urls")),
    path("api/", include("apps.quests.urls")),
    path("api/", include("apps.google_integration.urls")),
    path("api/", include("apps.activity.urls")),
    path("api/", include("apps.chronicle.urls")),
    path("api/", include("apps.creations.urls")),
    path("api/", include("apps.lorebook.urls")),
    path("api/", include("apps.movement.urls")),
    path("api/", include("apps.wellbeing.urls")),
    path("api/", include("apps.printing.urls")),
    # Dev-tools REST surface. URLs always mount — the gate runs at the
    # view permission layer (``IsDevToolsEnabled``) so it's re-checked
    # per request and survives runtime ``DEV_TOOLS_ENABLED`` toggles.
    # See ``apps/dev_tools/gate.py`` + ``apps/dev_tools/permissions.py``.
    path("api/dev/", include("apps.dev_tools.urls")),
    # OAuth 2.1 — admin REST surface for /manage → Admin → OAuth Clients.
    # Staff-parent-gated. The frontend gates the Admin tab on the existing
    # ``adminPing()`` → ``/admin/families/`` probe, so we don't need a
    # second ping endpoint here.
    path("api/admin/oauth/applications/", AdminApplicationListView.as_view()),
    path(
        "api/admin/oauth/applications/<str:client_id>/tokens/",
        AdminApplicationRevokeTokensView.as_view(),
    ),
    path("api/admin/oauth/tokens/", AdminTokenListView.as_view()),
    path("api/admin/oauth/tokens/<int:token_id>/", AdminTokenRevokeView.as_view()),

    # ───────── OAuth 2.1 / MCP-spec discovery + endpoints ─────────
    # RFC 9728 protected-resource metadata + RFC 8414 auth-server metadata.
    # Mount paths sit OUTSIDE /api/ because the well-known prefix is reserved
    # at the origin root by IETF convention. Cacheable for an hour.
    path(
        ".well-known/oauth-protected-resource",
        WellKnownProtectedResourceView.as_view(),
        name="oauth-protected-resource",
    ),
    path(
        ".well-known/oauth-authorization-server",
        WellKnownAuthorizationServerView.as_view(),
        name="oauth-authorization-server",
    ),
    # Authorize view — DOT's, with a staff-parent gate. MUST come before the
    # ``oauth2_provider`` include so this URL wins resolution.
    path("oauth/authorize/", AbbyAuthorizationView.as_view(), name="oauth-authorize"),
    # Tiny login-during-consent view (LOGIN_URL points here). Authenticates
    # session-style + redirects back to /oauth/authorize/ via ?next=.
    path("oauth/login/", OAuthLoginView.as_view(), name="oauth-login"),
    # RFC 7591 dynamic client registration. Public, throttled.
    path("oauth/register/", DynamicClientRegistrationView.as_view(), name="oauth-register"),
    # Token endpoint, revocation, introspection — DOT defaults.
    path("oauth/", include("oauth2_provider.urls", namespace="oauth2_provider")),
]

# Serve /media/ through Django when uploads live on local disk. With
# USE_S3_STORAGE=true (production), uploads live in MinIO and the browser
# fetches them directly from s3.neato.digital via presigned URLs — Django
# never touches the bytes, so this route is dropped to avoid exposing an
# empty (or stale) media directory at a public path.
if not settings.USE_S3_STORAGE:
    urlpatterns += [
        re_path(
            r"^media/(?P<path>.*)$",
            static_serve,
            {"document_root": str(settings.MEDIA_ROOT)},
        ),
    ]

# PWA root files — these MUST be served from / (not /static/) so the service
# worker has root scope and the manifest serves with the right content type.
# Inserted before the SPA catch-all so it doesn't intercept them.
_PWA_ROOT_FILES = [
    "sw.js",
    # Imported by sw.js via workbox importScripts, so it must serve from root
    # with the same scope as the service worker itself.
    "push-sw.js",
    "registerSW.js",
    "manifest.webmanifest",
    "pwa-192x192.png",
    "pwa-512x512.png",
    "maskable-icon-512x512.png",
    "apple-touch-icon.png",
    "favicon.svg",
]

# These scripts have stable URLs, so both the worker and its imports must be
# revalidated. Icons and the manifest retain their existing caching behavior.
_PWA_REVALIDATED_SCRIPTS = {"sw.js", "push-sw.js", "registerSW.js"}


def _pwa_static_serve(request, path):
    """Serve PWA root files, keeping unversioned scripts fresh on update checks."""
    response = static_serve(
        request,
        path,
        document_root=str(settings.BASE_DIR / "frontend_dist"),
    )
    if path in _PWA_REVALIDATED_SCRIPTS:
        # Apply after static_serve so HEAD and conditional 304 responses carry
        # the same policy. Imported scripts can use the browser HTTP cache even
        # when the top-level worker's update check bypasses it.
        response["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
        # Keep Cloudflare's edge policy separate from its browser TTL rewriting.
        # A provider cache-rule override still needs the prepared path exception.
        response["Cloudflare-CDN-Cache-Control"] = "no-store"
    return response


urlpatterns += [
    re_path(
        rf"^(?P<path>{'|'.join(re.escape(f) for f in _PWA_ROOT_FILES)})$",
        _pwa_static_serve,
        name="pwa-root-file",
    ),
]

# SPA catch-all — MUST be last. React Router owns every other path.
# Exclude:
#   - static/ so missing assets get a proper 404 instead of index.html
#     served as text/html (WhiteNoise handles real static files at the
#     middleware layer before the URL resolver runs).
#   - .well-known/ + oauth/ so MCP-spec OAuth 2.1 discovery + endpoint
#     probes (mcp-remote, Cowork, Claude Desktop) reach the real OAuth
#     views above. The .well-known prefix is reserved by IETF convention
#     and the SPA must never claim either prefix — otherwise HTML-when-
#     JSON-expected crashes the client before it sends the auth header.
urlpatterns += [
    re_path(r"^(?!static/|\.well-known/|oauth/).*$", spa_view, name="spa"),
]
