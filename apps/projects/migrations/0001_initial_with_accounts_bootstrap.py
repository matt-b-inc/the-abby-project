"""Repair fresh installs without changing previously applied migrations.

Under AUTH_USER_MODEL=accounts.User, projects.0001 skips its swapped User
CreateModel but immediately needs accounts.User for Project's foreign keys.
accounts.0001 cannot run first: it depends on projects.0015. Bootstrap the
same historical accounts model here, then let accounts.0001 adopt it later.

This replacement retains projects.0001's dependencies and operations. Django
considers it applied when the original projects.0001 is recorded, so existing
databases do not execute the bootstrap or recreate their user tables. Keep
both original migration files: they are imported historical definitions and
must remain available for deployed migration records.
"""

from importlib import import_module

from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.operations.base import Operation


_projects_initial = import_module("apps.projects.migrations.0001_initial").Migration
_accounts_initial = import_module("apps.accounts.migrations.0001_initial").Migration
_account_user = _accounts_initial.operations[0].state_operations[0]


class BootstrapAccountUser(Operation):
    """Apply the frozen User CreateModel under its accounts app label.

    Delegating to CreateModel preserves backend/router behavior and the legacy
    projects_user and projects_user_{groups,user_permissions} table names. The
    definition includes theme because projects.0003 skips altering swapped User.

    A replacement can also be considered applied on a legacy database without
    running this operation. Reversing it must not drop that pre-existing user
    table or its auth memberships, so reversing the initial migration is blocked.
    """

    reversible = False

    def state_forwards(self, app_label, state):
        _account_user.state_forwards("accounts", state)

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        _account_user.database_forwards("accounts", schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        raise IrreversibleError("The historical user bootstrap must preserve existing user tables.")

    def describe(self):
        return "Bootstrap historical accounts.User and its legacy tables"


class Migration(migrations.Migration):
    initial = True

    replaces = [("projects", "0001_initial")]
    dependencies = _projects_initial.dependencies
    operations = [BootstrapAccountUser(), *_projects_initial.operations]
