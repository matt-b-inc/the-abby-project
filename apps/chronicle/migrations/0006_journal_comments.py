from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("chronicle", "0005_journal_client_entry_id"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ChronicleComment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("body", models.TextField(max_length=2000)),
                ("client_comment_id", models.UUIDField(blank=True, null=True)),
                ("author", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="chronicle_comments", to=settings.AUTH_USER_MODEL,
                )),
                ("entry", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="comments", to="chronicle.chronicleentry",
                )),
            ],
            options={
                "ordering": ["created_at", "pk"],
                "constraints": [models.UniqueConstraint(
                    fields=("author", "client_comment_id"), name="unique_chronicle_comment_request",
                )],
            },
        ),
    ]
