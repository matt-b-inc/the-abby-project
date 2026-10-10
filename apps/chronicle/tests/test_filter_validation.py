"""Chronicle query validation must preserve family and sharing boundaries."""
from datetime import date

from rest_framework.test import APITestCase

from apps.chronicle.models import ChronicleEntry
from config.tests.factories import make_family


class ChronicleFilterValidationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        family = make_family(
            parents=[{"username": "filter-parent"}],
            children=[{"username": "filter-child"}, {"username": "filter-sibling"}],
        )
        other_family = make_family(
            parents=[{"username": "filter-other-parent"}],
            children=[{"username": "filter-other-child"}],
        )
        cls.parent = family.parents[0]
        cls.child, cls.sibling = family.children
        cls.other_child = other_family.children[0]
        cls.public_entry = cls.make_entry(cls.child, "manual", 2020)
        cls.later_entry = cls.make_entry(cls.child, "manual", 2021)
        cls.private_journal = cls.make_entry(cls.child, "journal", 2020, private=True)
        cls.shared_journal = cls.make_entry(cls.child, "journal", 2021)
        cls.private_grade = cls.make_entry(cls.child, "grade", 2020, private=True)
        cls.shared_grade = cls.make_entry(cls.child, "grade", 2021)
        cls.sibling_entry = cls.make_entry(cls.sibling, "manual", 2020)
        cls.other_entry = cls.make_entry(cls.other_child, "manual", 2020)

    @staticmethod
    def make_entry(user, kind, year, *, private=False):
        return ChronicleEntry.objects.create(
            user=user,
            kind=kind,
            occurred_on=date(year, 10, 1),
            chapter_year=year,
            title=f"{user.username} {kind} {year}",
            is_private=private,
        )

    @staticmethod
    def entries(response):
        payload = response.json()
        if "chapters" in payload:
            return [entry for chapter in payload["chapters"] for entry in chapter["entries"]]
        return payload["results"] if isinstance(payload, dict) else payload

    def assert_invalid_filter(self, field, values):
        self.client.force_authenticate(self.parent)
        for url in ("/api/chronicle/", "/api/chronicle/summary/", "/api/chronicle/grades/"):
            for value in values:
                with self.subTest(url=url, field=field, value=value):
                    response = self.client.get(url, {field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(set(response.json()), {field})
                    self.assertIsInstance(response.json()[field], list)

    def test_malformed_user_ids_return_field_errors(self):
        self.assert_invalid_filter("user_id", ("abc", "1.5", " ", "1e2"))

    def test_out_of_range_user_ids_return_field_errors(self):
        self.assert_invalid_filter("user_id", ("0", "-1", str(2**63), "9" * 100))

    def test_malformed_chapter_years_return_field_errors(self):
        self.assert_invalid_filter("chapter_year", ("abc", "2026.5", " ", "2e3"))

    def test_out_of_range_chapter_years_return_field_errors(self):
        self.assert_invalid_filter("chapter_year", ("0", "-1", "10000", "9" * 100))

    def test_blank_optional_filters_are_ignored(self):
        for user in (self.parent, self.child):
            self.client.force_authenticate(user)
            for url in ("/api/chronicle/", "/api/chronicle/summary/", "/api/chronicle/grades/"):
                with self.subTest(user=user.pk, url=url):
                    unfiltered = self.client.get(url)
                    response = self.client.get(url, {"user_id": "", "chapter_year": ""})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), unfiltered.json())

    def test_all_invalid_fields_are_reported_consistently(self):
        self.client.force_authenticate(self.parent)
        responses = [
            self.client.get(url, {"user_id": "abc", "chapter_year": "invalid"})
            for url in ("/api/chronicle/", "/api/chronicle/summary/", "/api/chronicle/grades/")
        ]
        for response in responses:
            self.assertEqual(response.status_code, 400)
            self.assertEqual(set(response.json()), {"user_id", "chapter_year"})
            self.assertEqual(response.json(), responses[0].json())

    def test_children_get_validation_errors_without_changing_scope(self):
        self.client.force_authenticate(self.child)
        for url in ("/api/chronicle/", "/api/chronicle/summary/", "/api/chronicle/grades/"):
            for field in ("user_id", "chapter_year"):
                with self.subTest(url=url, field=field):
                    response = self.client.get(url, {field: "abc"})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.json())

    def test_integral_decimal_filters_are_normalized_for_parent_lists(self):
        self.client.force_authenticate(self.parent)
        for url, expected in (
            ("/api/chronicle/", {self.later_entry.pk, self.shared_journal.pk, self.shared_grade.pk}),
            ("/api/chronicle/grades/", {self.shared_grade.pk}),
        ):
            with self.subTest(url=url):
                response = self.client.get(url, {
                    "user_id": f"{self.child.pk}.0", "chapter_year": "2021.0",
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual({entry["id"] for entry in self.entries(response)}, expected)

    def test_integral_decimal_user_id_is_normalized_for_summary(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get("/api/chronicle/summary/", {"user_id": f"{self.child.pk}.0"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {entry["id"] for entry in self.entries(response)},
            {self.public_entry.pk, self.later_entry.pk, self.shared_journal.pk, self.shared_grade.pk},
        )

    def test_valid_parent_filters_preserve_private_entry_access(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get("/api/chronicle/", {
            "user_id": self.child.pk, "chapter_year": 2020,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual([entry["id"] for entry in self.entries(response)], [self.public_entry.pk])

    def test_summary_still_returns_all_chapters_for_a_valid_chapter_parameter(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get("/api/chronicle/summary/", {
            "user_id": self.child.pk, "chapter_year": "2020.0",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual({chapter["chapter_year"] for chapter in response.json()["chapters"]}, {2020, 2021})

    def test_parent_list_cannot_probe_another_family(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get("/api/chronicle/", {
            "user_id": f"{self.other_child.pk}.0", "chapter_year": "2020.0",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.entries(response), [])

    def test_parent_summary_requires_a_child_in_the_same_family(self):
        self.client.force_authenticate(self.parent)
        for target in (self.other_child, self.parent):
            with self.subTest(target=target.pk):
                response = self.client.get("/api/chronicle/summary/", {"user_id": f"{target.pk}.0"})
                self.assertEqual(response.status_code, 404)

    def test_child_lists_ignore_other_user_ids_and_keep_private_entries(self):
        self.client.force_authenticate(self.child)
        for target in (self.sibling, self.other_child):
            with self.subTest(target=target.pk):
                response = self.client.get("/api/chronicle/", {
                    "user_id": f"{target.pk}.0", "chapter_year": "2020.0",
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    {entry["id"] for entry in self.entries(response)},
                    {self.public_entry.pk, self.private_journal.pk, self.private_grade.pk},
                )

    def test_child_summary_ignores_other_user_ids_and_keeps_private_entries(self):
        self.client.force_authenticate(self.child)
        for target in (self.sibling, self.other_child):
            with self.subTest(target=target.pk):
                response = self.client.get("/api/chronicle/summary/", {"user_id": f"{target.pk}.0"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    {entry["id"] for entry in self.entries(response)},
                    {self.public_entry.pk, self.later_entry.pk, self.private_journal.pk,
                     self.shared_journal.pk, self.private_grade.pk, self.shared_grade.pk},
                )

    def test_filters_do_not_bypass_authentication(self):
        for url in ("/api/chronicle/", "/api/chronicle/summary/", "/api/chronicle/grades/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, {"user_id": "abc"}).status_code, 401)
