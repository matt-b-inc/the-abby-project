"""Tests for PWA root-file URL handling.

Problem: Django's SPA catch-all (re_path(r"^(?!static/|[.]well-known/).*$", spa_view))
greedily matches any unmatched path and returns the React index.html. For a PWA
this is fatal — the service worker MUST be served from /sw.js (not /static/sw.js)
to control the whole app, and browsers reject manifests served as text/html.

Fix: explicit URL routes for the small set of PWA root files, served from
frontend_dist/ directly. The three root scripts must revalidate in browsers and
bypass Cloudflare edge storage, including HEAD and conditional 304 responses,
so an obsolete service worker cannot hide a new release from update detection.

Test hygiene: we can't point static_serve at a non-existent directory, so each
test run writes tiny fixture files to a tempdir and overrides BASE_DIR so the
_pwa_static_serve view reads from the tempdir. No files are created in the real
frontend_dist/ directory — running these tests never touches the build output.
"""
import shutil
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings

_FIXTURE_FILES = {
    "sw.js": b"// fixture sw\n",
    "push-sw.js": b"// fixture push sw\n",
    "registerSW.js": b"// fixture registerSW\n",
    "manifest.webmanifest": b'{"name":"Abby"}',
    "pwa-192x192.png": b"\x89PNG\r\n\x1a\n",
    "pwa-512x512.png": b"\x89PNG\r\n\x1a\n",
    "maskable-icon-512x512.png": b"\x89PNG\r\n\x1a\n",
    "apple-touch-icon.png": b"\x89PNG\r\n\x1a\n",
    "favicon.svg": b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
}
_PWA_SCRIPT_FILES = ("sw.js", "push-sw.js", "registerSW.js")


def _response_body(response):
    """Consume FileResponse bytes and close the fixture's file handle."""
    try:
        return b"".join(response.streaming_content) if response.streaming else response.content
    finally:
        response.close()


class PwaRoutingTests(SimpleTestCase):
    """Pins the PWA root-file routes added in config/urls.py.

    setUpClass spins up a tempdir, materializes fixture files there, and uses
    override_settings to repoint BASE_DIR at it. tearDownClass rips the tempdir
    back down. The real frontend_dist/ is never touched.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmp_base_dir = Path(tempfile.mkdtemp(prefix="abby-pwa-test-"))
        (cls._tmp_base_dir / "frontend_dist").mkdir()
        for name, body in _FIXTURE_FILES.items():
            (cls._tmp_base_dir / "frontend_dist" / name).write_bytes(body)
        cls._settings_override = override_settings(BASE_DIR=cls._tmp_base_dir)
        cls._settings_override.enable()

    @classmethod
    def tearDownClass(cls):
        try:
            cls._settings_override.disable()
        finally:
            shutil.rmtree(cls._tmp_base_dir, ignore_errors=True)
        super().tearDownClass()

    def test_sw_js_returns_file_not_html(self):
        resp = self.client.get("/sw.js")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def assert_script_cache_policy(self, response):
        self.assertEqual(response["Cache-Control"], "no-cache, max-age=0, must-revalidate")
        self.assertEqual(response["Cloudflare-CDN-Cache-Control"], "no-store")

    def test_pwa_scripts_get_and_head_revalidate_and_bypass_edge_storage(self):
        for name in _PWA_SCRIPT_FILES:
            for method in ("get", "head"):
                with self.subTest(script=name, method=method):
                    response = getattr(self.client, method)(f"/{name}")
                    self.assertEqual(response.status_code, 200)
                    self.assertIn("javascript", response["Content-Type"])
                    self.assert_script_cache_policy(response)
                    self.assertEqual(_response_body(response), _FIXTURE_FILES[name] if method == "get" else b"")

    def test_pwa_script_query_strings_keep_the_same_cache_policy(self):
        """Cache-busting query strings must not turn a root script into SPA HTML."""
        for name in _PWA_SCRIPT_FILES:
            for method in ("get", "head"):
                with self.subTest(script=name, method=method):
                    response = getattr(self.client, method)(f"/{name}?release=synthetic")
                    self.assertEqual(response.status_code, 200)
                    self.assertIn("javascript", response["Content-Type"])
                    self.assert_script_cache_policy(response)
                    self.assertEqual(_response_body(response), _FIXTURE_FILES[name] if method == "get" else b"")

    def test_pwa_script_last_modified_304_keeps_browser_and_edge_policy(self):
        """304 responses can update stored cache metadata, so they need the policy too."""
        for name in _PWA_SCRIPT_FILES:
            initial_response = self.client.get(f"/{name}")
            self.assertEqual(initial_response.status_code, 200)
            last_modified = initial_response["Last-Modified"]
            self.assertEqual(_response_body(initial_response), _FIXTURE_FILES[name])
            for method in ("get", "head"):
                for query in ("", "?release=synthetic"):
                    with self.subTest(script=name, method=method, query=query):
                        response = getattr(self.client, method)(
                            f"/{name}{query}", HTTP_IF_MODIFIED_SINCE=last_modified,
                        )
                        self.assertEqual(response.status_code, 304)
                        self.assert_script_cache_policy(response)
                        self.assertEqual(_response_body(response), b"")

    def test_icons_and_manifest_do_not_receive_script_cache_policy(self):
        for name in _FIXTURE_FILES.keys() - set(_PWA_SCRIPT_FILES):
            for method in ("get", "head"):
                with self.subTest(file=name, method=method):
                    response = getattr(self.client, method)(f"/{name}")
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn("Cache-Control", response)
                    self.assertNotIn("Cloudflare-CDN-Cache-Control", response)
                    last_modified = response["Last-Modified"]
                    self.assertEqual(_response_body(response), _FIXTURE_FILES[name] if method == "get" else b"")
                    conditional = getattr(self.client, method)(f"/{name}", HTTP_IF_MODIFIED_SINCE=last_modified)
                    self.assertEqual(conditional.status_code, 304)
                    self.assertNotIn("Cache-Control", conditional)
                    self.assertNotIn("Cloudflare-CDN-Cache-Control", conditional)
                    self.assertEqual(_response_body(conditional), b"")

    def test_missing_root_scripts_return_404_instead_of_spa_html(self):
        with tempfile.TemporaryDirectory(prefix="abby-pwa-missing-test-") as temporary_base:
            with override_settings(BASE_DIR=Path(temporary_base)):
                for name in _PWA_SCRIPT_FILES:
                    for method in ("get", "head"):
                        with self.subTest(script=name, method=method):
                            response = getattr(self.client, method)(f"/{name}")
                            self.assertEqual(response.status_code, 404)
                            _response_body(response)

    def test_push_sw_js_returns_file_not_html(self):
        response = self.client.get("/push-sw.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response["Content-Type"])
        self.assertEqual(_response_body(response), _FIXTURE_FILES["push-sw.js"])

    def test_register_sw_js_returns_file_not_html(self):
        resp = self.client.get("/registerSW.js")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_manifest_returns_file_not_html(self):
        resp = self.client.get("/manifest.webmanifest")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_pwa_icon_returns_file_not_html(self):
        resp = self.client.get("/pwa-192x192.png")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_pwa_icon_large_returns_file_not_html(self):
        resp = self.client.get("/pwa-512x512.png")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_maskable_icon_returns_file_not_html(self):
        resp = self.client.get("/maskable-icon-512x512.png")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_apple_touch_icon_returns_file_not_html(self):
        resp = self.client.get("/apple-touch-icon.png")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_favicon_svg_returns_file_not_html(self):
        resp = self.client.get("/favicon.svg")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("text/html", resp["Content-Type"])

    def test_unknown_root_file_falls_through_to_spa(self):
        """Guard: only the listed PWA files get intercepted. Everything else
        still hits the SPA catch-all so React Router keeps working."""
        resp = self.client.get("/random-nonexistent-thing.txt")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp["Content-Type"])

    def test_unknown_root_path_falls_through_to_spa(self):
        resp = self.client.get("/some-react-route")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp["Content-Type"])
