"""Exercise real migrations outside the suite's syncdb shortcut.

Each check runs in a fresh Python process with an explicit in-memory SQLite
database. No shell database credentials, infrastructure settings, or .env
files are loaded. Historical fixtures never execute the replacement migration.
"""

import os
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest


_REPO_ROOT = Path(__file__).resolve().parents[3]
_BOOTSTRAP_ENV = (
    "PATH", "SystemRoot", "WINDIR", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
    "HOME", "USERPROFILE",
)

_SETUP = """
import django
django.setup()

from importlib import import_module
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder

assert not getattr(settings, "MIGRATION_MODULES", {}), "syncdb conceals the migration graph"
assert connection.vendor == "sqlite"
assert connection.settings_dict["NAME"] == ":memory:"

REPLACEMENT = ("projects", "0001_initial_with_accounts_bootstrap")
ORIGINAL = ("projects", "0001_initial")
ACCOUNT_INITIAL = import_module("apps.accounts.migrations.0001_initial").Migration


class OriginalMigrationLoader(MigrationLoader):
    def load_disk(self):
        super().load_disk()
        self.disk_migrations.pop(REPLACEMENT, None)


def migrate_original(targets=None):
    # The original graph cannot bootstrap accounts.User itself. Independently
    # create the already-deployed legacy table, then execute only original
    # migrations. This models an installation whose table predates the app
    # extraction, without applying the repair and manipulating its recorder.
    with patch("django.db.migrations.executor.MigrationLoader", OriginalMigrationLoader):
        executor = MigrationExecutor(connection)
        state = executor.migrate([("auth", "0012_alter_user_first_name_max_length")])
        create_user = ACCOUNT_INITIAL.operations[0].state_operations[0]
        create_user.state_forwards("accounts", state)
        with connection.schema_editor() as schema_editor:
            schema_editor.create_model(state.apps.get_model("accounts", "User"))
        executor = MigrationExecutor(connection)
        targets = targets or executor.loader.graph.leaf_nodes()
        state = executor.migrate(targets, state=state)
        assert REPLACEMENT not in MigrationRecorder(connection).applied_migrations()
        assert ORIGINAL in MigrationRecorder(connection).applied_migrations()
        return state


def write_sentinels(state):
    # Historical models avoid runtime signals while exercising the real schema.
    User = state.apps.get_model("accounts", "User")
    Project = state.apps.get_model("projects", "Project")
    Group = state.apps.get_model("auth", "Group")
    Permission = state.apps.get_model("auth", "Permission")
    ContentType = state.apps.get_model("contenttypes", "ContentType")
    user_fields = {field.name for field in User._meta.fields}
    extra = {}
    if "family" in user_fields:
        Family = state.apps.get_model("families", "Family")
        extra["family"] = Family.objects.create(name="Migration Family", slug="migration-family")
    password = make_password("migration-sentinel-password")
    user = User.objects.create(
        username="migration-sentinel", password=password, role="parent",
        display_name="Preserved Parent", theme="winter", **extra,
    )
    group = Group.objects.create(name="migration-sentinel-group")
    content_type = ContentType.objects.create(app_label="accounts", model="migration_sentinel")
    permission = Permission.objects.create(
        name="Migration sentinel permission", codename="migration_sentinel",
        content_type=content_type,
    )
    user.groups.add(group)
    user.user_permissions.add(permission)
    project = Project.objects.create(
        title="Preserved Project", created_by=user, assigned_to=user,
    )
    return user.pk, password, group.pk, permission.pk, project.pk


def check_sentinels(sentinel):
    # Read through current ORM models to detect missing current user columns.
    from apps.accounts.models import User
    from apps.projects.models import Project
    user_id, password, group_id, permission_id, project_id = sentinel
    user = User.objects.get(pk=user_id)
    assert user.username == "migration-sentinel"
    assert user.password == password
    assert user.check_password("migration-sentinel-password")
    assert user.display_name == "Preserved Parent"
    assert user.theme == "winter"
    assert list(user.groups.values_list("pk", flat=True)) == [group_id]
    assert list(user.user_permissions.values_list("pk", flat=True)) == [permission_id]
    project = Project.objects.get(pk=project_id)
    assert project.title == "Preserved Project"
    assert project.created_by_id == user_id
    assert project.assigned_to_id == user_id
    assert User._meta.db_table == "projects_user"
    assert User._meta.get_field("groups").remote_field.through._meta.db_table == "projects_user_groups"
    assert User._meta.get_field("user_permissions").remote_field.through._meta.db_table == "projects_user_user_permissions"
    tables = set(connection.introspection.table_names())
    assert {"projects_user", "projects_user_groups", "projects_user_user_permissions"} <= tables
    assert "accounts_user" not in tables
    return user


def database_snapshot():
    # Compare every table and every schema object, allowing only the migration
    # recorder row/counter which Django adds for a recognized replacement.
    with connection.cursor() as cursor:
        cursor.execute("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
        schema = cursor.fetchall()
        rows = {}
        for table in sorted(connection.introspection.table_names()):
            if table == "django_migrations":
                continue
            cursor.execute("SELECT * FROM " + connection.ops.quote_name(table) + " ORDER BY rowid")
            rows[table] = cursor.fetchall()
        cursor.execute("SELECT name, seq FROM sqlite_sequence WHERE name != 'django_migrations' ORDER BY name")
        sequences = cursor.fetchall()
    return schema, rows, sequences
"""


class RealMigrationGraphTests(unittest.TestCase):
    def run_migration_check(self, code):
        env = {key: os.environ[key] for key in _BOOTSTRAP_ENV if key in os.environ}
        env.update({
            "DJANGO_SETTINGS_MODULE": "config.settings_test",
            "DATABASE_URL": "sqlite:///:memory:",
            "SECRET_KEY": "migration-regression-disposable-key",
            "DEBUG": "True",
        })
        result = subprocess.run(
            [sys.executable, "-c", textwrap.dedent(_SETUP) + textwrap.dedent(code)],
            cwd=_REPO_ROOT, env=env, capture_output=True, text=True, timeout=90,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_fresh_real_graph_creates_legacy_user_tables_and_current_user_schema(self):
        self.run_migration_check("""
            executor = MigrationExecutor(connection)
            assert REPLACEMENT in executor.loader.graph.nodes
            assert ORIGINAL not in executor.loader.graph.nodes
            targets = executor.loader.graph.leaf_nodes()
            state = executor.migrate(targets)
            user = check_sentinels(write_sentinels(state))
            # Exercise a real update to the column skipped by swapped projects.User.
            user.theme = "autumn"
            user.save(update_fields=["theme"])
            user.refresh_from_db()
            assert user.theme == "autumn"
            assert user.family.slug == "migration-family"
            from apps.accounts.models import User
            created = User.objects.create_user(
                username="fresh-current-user", password="current-user-password",
                role="parent", family=user.family, theme="spring",
                lorebook_flags={"migration": True},
            )
            created.refresh_from_db()
            assert created.check_password("current-user-password")
            assert created.family_id == user.family_id
            assert created.theme == "spring"
            assert created.lorebook_flags == {"migration": True}
            executor = MigrationExecutor(connection)
            executor.loader.check_consistent_history(connection)
            assert executor.migration_plan(executor.loader.graph.leaf_nodes()) == []
            applied = MigrationRecorder(connection).applied_migrations()
            assert REPLACEMENT in applied and ORIGINAL in applied
        """)

    def test_original_applied_history_is_schema_and_data_noop(self):
        self.run_migration_check("""
            original_state = migrate_original()
            sentinel = write_sentinels(original_state)
            before = database_snapshot()
            recorded_before = set(MigrationRecorder(connection).applied_migrations())
            sql = []
            def capture(execute, statement, params, many, context):
                sql.append(statement)
                return execute(statement, params, many, context)
            with connection.execute_wrapper(capture):
                executor = MigrationExecutor(connection)
                executor.loader.check_consistent_history(connection)
                assert executor.loader.project_state().models == original_state.models
                targets = executor.loader.graph.leaf_nodes()
                assert executor.migration_plan(targets) == []
                executor.migrate(targets)
            assert database_snapshot() == before
            check_sentinels(sentinel)
            recorded_after = set(MigrationRecorder(connection).applied_migrations())
            assert recorded_after - recorded_before == {REPLACEMENT}
            assert recorded_before <= recorded_after
            writes = [statement for statement in sql if statement.lstrip().split()[0].upper()
                      in {"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "REPLACE"}]
            assert len(writes) == 1, writes
            assert writes[0].startswith('INSERT INTO "django_migrations"'), writes
        """)

    def test_original_partial_history_advances_and_preserves_user_relationships(self):
        self.run_migration_check("""
            state = migrate_original([("accounts", "0002_alter_user_options_alter_user_managers")])
            sentinel = write_sentinels(state)
            executor = MigrationExecutor(connection)
            executor.loader.check_consistent_history(connection)
            targets = executor.loader.graph.leaf_nodes()
            assert executor.migration_plan(targets)
            executor.migrate(targets)
            user = check_sentinels(sentinel)
            assert user.family.slug == "default-family"
            assert user.family.primary_parent_id == user.pk
            executor = MigrationExecutor(connection)
            assert executor.migration_plan(executor.loader.graph.leaf_nodes()) == []
        """)

    def test_bootstrap_rollback_refuses_before_any_sql(self):
        self.run_migration_check("""
            from django.db.migrations.exceptions import IrreversibleError
            from django.db.migrations.state import ProjectState
            migration = import_module("apps.projects.migrations.0001_initial_with_accounts_bootstrap").Migration(
                REPLACEMENT[1], REPLACEMENT[0],
            )
            with connection.schema_editor(collect_sql=True) as schema_editor:
                try:
                    migration.unapply(ProjectState(), schema_editor)
                except IrreversibleError:
                    pass
                else:
                    raise AssertionError("bootstrap rollback must preserve deployed legacy tables")
                assert schema_editor.collected_sql == []
        """)
