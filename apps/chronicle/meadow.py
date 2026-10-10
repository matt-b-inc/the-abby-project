"""A read-only collection projected from confirmed journal reward receipts.

The journal remains the source of truth. Loading the meadow neither claims
items nor grants rewards, and never carries journal text or family replies.
"""
from apps.chronicle.models import ChronicleEntry


RECENT_KEEPSAKE_LIMIT = 30


def journal_meadow_progress(user):
    keepsakes = []
    count = 0
    xp_awarded = 0
    # Read only fields needed for this projection. Creation time and receipt
    # identity remain stable through journal edits and interrupted-save replays.
    entries = (
        ChronicleEntry.objects.filter(user=user, kind=ChronicleEntry.Kind.JOURNAL)
        .order_by("-created_at", "-pk")
        .values("id", "created_at", "metadata")
    )
    for entry in entries.iterator(chunk_size=200):
        metadata = entry["metadata"]
        receipt = metadata.get("reward_receipt") if isinstance(metadata, dict) else None
        if not isinstance(receipt, dict):
            continue
        receipt_id = f"journal:{entry['id']}"
        xp = receipt.get("xp_awarded")
        if (
            receipt.get("receipt_id") != receipt_id
            or receipt.get("status") != "awarded"
            or type(xp) is not int
            or xp <= 0
        ):
            continue
        count += 1
        xp_awarded += xp
        if len(keepsakes) < RECENT_KEEPSAKE_LIMIT:
            keepsakes.append({
                "receipt_id": receipt_id,
                "type": "memory_bloom",
                "title": "Memory bloom",
                "earned_at": entry["created_at"].isoformat(),
            })
    return {
        "schema_version": 1,
        "keepsake_count": count,
        "journal_xp_awarded": xp_awarded,
        "keepsakes": keepsakes,
    }
