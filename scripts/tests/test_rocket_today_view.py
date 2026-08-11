"""write_today_view must not dirty the file on a no-op run.

WHY THIS EXISTS: `fetched_at_utc` changes on every run by definition, so
stamping it unconditionally made src/data/rocket_today.json dirty even when
the rates were byte-identical. That kept the residential runner's own
"No Rocket data changes ... Nothing to push" branch permanently unreachable,
so every weekly run produced a commit, a push, and a full Pages redeploy that
carried nothing but a new timestamp.

Observed live on 2026-08-10: three consecutive runs of the scheduled task
produced 4ff3bb83, 442099ed and 6f2662ec, each "1 file changed, 1 insertion(+),
1 deletion(-)", each one only the timestamp.

The timestamp must still advance when a real value moves — otherwise "when did
this rate last change" becomes unanswerable, which is a worse defect than the
one being fixed. Both directions are asserted below.
"""
import json
import os

from fetch_rocket import write_today_view


def _row(**over):
    row = {
        "fetched_at_utc": "2026-08-11T01:00:00+00:00",
        "date_iso": "2026-08-11",
        "term_15": 5.99,
        "term_15_apr": 6.426,
        "term_30": 6.75,
        "term_30_apr": 7.027,
    }
    row.update(over)
    return row


def test_identical_rates_preserve_the_previous_timestamp(tmp_path):
    p = str(tmp_path / "rocket_today.json")
    write_today_view(p, _row())
    first = open(p).read()

    # Same rates, later clock — the only thing a no-op re-run changes.
    write_today_view(p, _row(fetched_at_utc="2026-08-11T02:00:00+00:00"))
    second = open(p).read()

    assert first == second, (
        "a no-op re-run rewrote rocket_today.json; this is what produced a "
        "commit + push + Pages deploy on every residential refresh"
    )


def test_changed_rate_does_advance_the_timestamp(tmp_path):
    p = str(tmp_path / "rocket_today.json")
    write_today_view(p, _row())

    write_today_view(p, _row(fetched_at_utc="2026-08-11T02:00:00+00:00", term_30=6.80))
    got = json.load(open(p))

    assert got["term_30"]["rate_pct"] == 6.80
    assert got["fetched_at_utc"] == "2026-08-11T02:00:00+00:00", (
        "a real rate change must still advance fetched_at_utc, or 'when did "
        "this number last move' becomes unanswerable"
    )


def test_changed_as_of_date_advances_the_timestamp(tmp_path):
    p = str(tmp_path / "rocket_today.json")
    write_today_view(p, _row())

    write_today_view(p, _row(fetched_at_utc="2026-08-12T02:00:00+00:00", date_iso="2026-08-12"))
    got = json.load(open(p))

    assert got["as_of_iso"] == "2026-08-12"
    assert got["fetched_at_utc"] == "2026-08-12T02:00:00+00:00"


def test_corrupt_existing_file_does_not_block_the_write(tmp_path):
    """A damaged view must be overwritten, not preserved — the guard is an
    optimisation, never a reason to keep bad data on disk."""
    p = str(tmp_path / "rocket_today.json")
    with open(p, "w") as f:
        f.write("{ not json")

    write_today_view(p, _row())
    got = json.load(open(p))

    assert got["term_30"]["rate_pct"] == 6.75
    assert got["fetched_at_utc"] == "2026-08-11T01:00:00+00:00"


def test_missing_file_writes_normally(tmp_path):
    p = str(tmp_path / "nested" / "rocket_today.json")
    write_today_view(p, _row())
    assert os.path.exists(p)
    assert json.load(open(p))["fetched_at_utc"] == "2026-08-11T01:00:00+00:00"
