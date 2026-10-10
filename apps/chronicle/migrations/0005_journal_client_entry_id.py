from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("chronicle", "0004_alter_chronicleentry_kind")]

    operations = [
        migrations.AddField(
            model_name="chronicleentry",
            name="client_entry_id",
            field=models.UUIDField(blank=True, editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="chronicleentry",
            constraint=models.UniqueConstraint(
                fields=("user", "client_entry_id"),
                name="unique_chronicle_client_entry_per_user",
            ),
        ),
        migrations.AlterField(
            model_name="chronicleentry",
            name="is_private",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Private journal entries are readable only by their author. "
                    "The author can explicitly share an entry with family."
                ),
            ),
        ),
    ]
