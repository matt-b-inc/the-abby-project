"""Tests for AuthView — login, logout, token rotation, throttling.

Audit C5 + H2: prior version had no throttle on login (unlimited
brute-force per IP) and never rotated the auth token (one leak = permanent
backdoor). Both are pinned here.
"""
from __future__ import annotations

from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.projects.models import User
from config.tests.factories import make_family


class _AuthFixture(TestCase):
    def setUp(self):
        # ScopedRateThrottle keeps its counters in the default cache
        # (LocMemCache in tests). Wipe between tests so one test's hammered
        # bucket doesn't poison the next.
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="parent", password="correct-horse-battery-staple",
            role="parent",
        )


class LoginSuccessTests(_AuthFixture):
    def test_valid_credentials_return_token_and_user(self):
        resp = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("token", body)
        self.assertEqual(body["username"], "parent")
        self.assertEqual(body["role"], "parent")
        # Token actually persists.
        self.assertTrue(Token.objects.filter(user=self.user, key=body["token"]).exists())


class LoginFailureTests(_AuthFixture):
    def test_unknown_user_returns_401(self):
        resp = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "ghost", "password": "x"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Invalid credentials", resp.json()["error"])

    def test_wrong_password_returns_401(self):
        resp = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "wrong"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)
        # No token gets minted on failed login.
        self.assertFalse(Token.objects.filter(user=self.user).exists())


class LoginTokenRotationTests(_AuthFixture):
    """Audit H2: every successful login mints a fresh token and revokes any
    prior one. Pre-fix, ``Token.objects.get_or_create`` returned the same
    key forever — once leaked, no rotation path.
    """

    def test_second_login_returns_different_token(self):
        first = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
            format="json",
        ).json()["token"]
        second = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
            format="json",
        ).json()["token"]

        self.assertNotEqual(first, second)

    def test_old_token_is_invalidated_after_relogin(self):
        first = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
            format="json",
        ).json()["token"]

        # Re-login → first token is revoked, replaced by a new one.
        second = self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
            format="json",
        ).json()["token"]

        self.assertFalse(Token.objects.filter(key=first).exists())
        self.assertTrue(Token.objects.filter(key=second).exists())

    def test_only_one_token_per_user_after_rotation(self):
        for _ in range(3):
            self.client.post(
                "/api/auth/",
                {"action": "login", "username": "parent", "password": "correct-horse-battery-staple"},
                format="json",
            )
        self.assertEqual(Token.objects.filter(user=self.user).count(), 1)


class LogoutTests(_AuthFixture):
    def test_logout_deletes_token(self):
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        resp = self.client.post(
            "/api/auth/", {"action": "logout"}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})
        self.assertFalse(Token.objects.filter(user=self.user).exists())

    def test_unauthenticated_logout_is_noop(self):
        resp = self.client.post(
            "/api/auth/", {"action": "logout"}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})

    def test_already_authenticated_old_logout_preserves_replacement_login(self):
        original = Token.objects.create(user=self.user)
        delayed_logout = APIClient()
        # Snapshot authentication before rotation, as DRF would do for an
        # in-flight logout. Reusing this validated object deliberately avoids
        # re-authenticating the now-revoked key when the old view resumes.
        delayed_logout.force_authenticate(user=self.user, token=original)

        login = self.client.post(
            "/api/auth/",
            {"action": "login", "username": self.user.username,
             "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        replacement = login.json()["token"]
        self.assertFalse(Token.objects.filter(key=original.key).exists())

        response = delayed_logout.post(
            "/api/auth/", {"action": "logout"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertTrue(Token.objects.filter(user=self.user, key=replacement).exists())
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {replacement}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)


class SharedBrowserSessionTests(TestCase):
    """Web and /play adopt one token; password login still rotates it.

    Distinct clients represent two browser surfaces. Adoption validates the
    existing credential with /auth/me/ instead of submitting a second login.
    """

    def setUp(self):
        cache.clear()
        self.a = make_family(
            "Browser Family A",
            parents=[{"username": "browser-parent-a"}],
            children=[{"username": "browser-child-a"}],
        )
        self.b = make_family(
            "Browser Family B",
            parents=[{"username": "browser-parent-b"}],
            children=[{"username": "browser-child-b"}],
        )
        self.web = APIClient()
        self.play = APIClient()

    def _login(self, client, user):
        response = client.post(
            "/api/auth/",
            {"action": "login", "username": user.username, "password": "pw"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], user.pk)
        token = response.json()["token"]
        client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        return token

    def _adopt(self, token, user):
        self.play.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        response = self.play.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], user.pk)
        self.assertEqual(response.json()["family"]["id"], user.family_id)
        self.assertNotIn("token", response.json())

    def test_play_adopts_web_login_without_revoking_either_client(self):
        user = self.a.children[0]
        token = self._login(self.web, user)
        self._adopt(token, user)

        # Repeated validation from either surface must keep the shared
        # session alive and leave the single DRF token unchanged.
        for client in (self.web, self.play, self.web, self.play):
            response = client.get("/api/auth/me/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["id"], user.pk)
        self.assertEqual(Token.objects.filter(user=user).count(), 1)
        self.assertTrue(Token.objects.filter(user=user, key=token).exists())

    def test_explicit_password_login_revokes_both_old_clients(self):
        user = self.a.children[0]
        original = self._login(self.web, user)
        self._adopt(original, user)

        replacement_client = APIClient()
        replacement = self._login(replacement_client, user)
        # Avoid including actual token values in assertion failure output.
        self.assertTrue(original != replacement)
        for client in (self.web, self.play):
            self.assertEqual(client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(replacement_client.get("/api/auth/me/").status_code, 200)
        self.assertFalse(Token.objects.filter(key=original).exists())
        self.assertEqual(Token.objects.filter(user=user).count(), 1)

    def test_logout_from_either_surface_revokes_shared_session(self):
        for logging_out_client in (self.web, self.play):
            with self.subTest(surface="web" if logging_out_client is self.web else "play"):
                # Each iteration starts with an unauthenticated login request;
                # revoked headers correctly fail before AuthView is reached.
                self.web.credentials()
                token = self._login(self.web, self.a.children[0])
                self._adopt(token, self.a.children[0])
                response = logging_out_client.post(
                    "/api/auth/", {"action": "logout"}, format="json",
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"ok": True})
                for client in (self.web, self.play):
                    self.assertEqual(client.get("/api/auth/me/").status_code, 401)
                self.assertFalse(Token.objects.filter(user=self.a.children[0]).exists())

    def test_stale_play_logout_cannot_revoke_replacement_login(self):
        user = self.a.children[0]
        original = self._login(self.web, user)
        self._adopt(original, user)
        self.web.credentials()
        replacement = self._login(self.web, user)

        response = self.play.post(
            "/api/auth/", {"action": "logout"}, format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.web.get("/api/auth/me/").status_code, 200)
        self.assertTrue(Token.objects.filter(user=user, key=replacement).exists())
        self.assertEqual(Token.objects.filter(user=user).count(), 1)

    def test_account_switch_adopts_new_identity_with_family_boundaries(self):
        original = self._login(self.web, self.a.parents[0])
        self._adopt(original, self.a.parents[0])
        logout = self.web.post("/api/auth/", {"action": "logout"}, format="json")
        self.assertEqual(logout.status_code, 200)
        self.web.credentials()

        replacement = self._login(self.web, self.b.parents[0])
        self.assertEqual(self.play.get("/api/auth/me/").status_code, 401)
        self._adopt(replacement, self.b.parents[0])
        for client in (self.web, self.play):
            response = client.get("/api/children/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                {row["id"] for row in response.json()["results"]},
                {self.b.children[0].pk},
            )
            foreign_child = client.get(f"/api/children/{self.a.children[0].pk}/")
            self.assertEqual(foreign_child.status_code, 404)
        self.assertFalse(Token.objects.filter(user=self.a.parents[0]).exists())
        self.assertTrue(Token.objects.filter(user=self.b.parents[0], key=replacement).exists())

    def test_child_adoption_keeps_parent_permissions_restricted(self):
        token = self._login(self.web, self.a.children[0])
        self._adopt(token, self.a.children[0])
        for client in (self.web, self.play):
            self.assertEqual(client.get("/api/children/").status_code, 403)


class UnknownActionTests(_AuthFixture):
    def test_returns_400(self):
        resp = self.client.post("/api/auth/", {"action": "fly"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid action", resp.json()["error"])

    def test_missing_action_returns_400(self):
        resp = self.client.post("/api/auth/", {}, format="json")
        self.assertEqual(resp.status_code, 400)


class LoginThrottleTests(_AuthFixture):
    """Audit C5: ``AuthView`` is throttled. Pre-fix it had no throttle and
    a bot could grind unlimited credential guesses against a known
    username from a single IP.

    Tests use the production rate (10/min) directly rather than via
    ``@override_settings(REST_FRAMEWORK=…)`` because DRF's ``api_settings``
    cache doesn't reliably reload on per-test overrides — override-based
    tests pass on isolated runs but flake when run alongside other tests
    that touch DRF settings. Firing 11 requests is cheap (no DB hit on
    failed-auth path) and pins the actual production behaviour.
    """

    def _login(self, password="wrong"):
        return self.client.post(
            "/api/auth/",
            {"action": "login", "username": "parent", "password": password},
            format="json",
        )

    def test_throttle_returns_429_after_rate_exhausted(self):
        # First 10 attempts pass the throttle (and 401 for wrong password).
        for i in range(10):
            resp = self._login()
            self.assertEqual(
                resp.status_code, 401,
                f"Attempt {i + 1} returned {resp.status_code}, expected 401",
            )
        # 11th attempt is throttled.
        resp = self._login()
        self.assertEqual(resp.status_code, 429)

    def test_successful_logins_also_count_toward_throttle(self):
        # Documented behaviour — the throttle is per-endpoint, not per-
        # outcome. Pin so a future refactor that splits success/failure
        # buckets makes a deliberate choice.
        for _ in range(10):
            resp = self._login(password="correct-horse-battery-staple")
            self.assertEqual(resp.status_code, 200)
        resp = self._login(password="correct-horse-battery-staple")
        self.assertEqual(resp.status_code, 429)
