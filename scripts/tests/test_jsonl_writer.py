"""4.3 — the JSONL accumulators are the archive; the writer must not eat them.

Three properties, one per original defect:
  (a) an exception mid-write leaves the original file byte-identical
      (the old `open(path, "w")` truncated first and re-serialised after);
  (b) a malformed line is REPORTED, not silently dropped from the rewrite;
  (c) a partial row does not replace a complete one for the same date
      (Rocket's Wayback/partial tiers used to demote a good row).
"""
import json

import pytest

import fetch_bankrate_state
import fetch_mnd_state
import fetch_nerdwallet_state
import fetch_rocket
from _jsonl import read_jsonl, upsert_jsonl, write_jsonl_atomic

ROWS = [
    {"date_iso": "2026-08-01", "term_30": 6.5},
    {"date_iso": "2026-08-02", "term_30": 6.6},
    {"date_iso": "2026-08-03", "term_30": 6.7},
]


def _seed(tmp_path, rows=ROWS, name="acc.jsonl"):
    p = tmp_path / name
    with open(p, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return p


def test_exception_mid_write_leaves_original_byte_identical(tmp_path, monkeypatch):
    p = _seed(tmp_path)
    before = p.read_bytes()

    class Boom(Exception):
        pass

    # Blow up partway through serialising, after the temp file is open.
    real_dumps = json.dumps
    calls = {"n": 0}

    def flaky_dumps(obj, *a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise Boom("disk full")
        return real_dumps(obj, *a, **k)

    monkeypatch.setattr("_jsonl.json.dumps", flaky_dumps)

    with pytest.raises(Boom):
        upsert_jsonl(str(p), {"date_iso": "2026-08-04", "term_30": 6.8})

    assert p.read_bytes() == before, "the accumulator was damaged by a failed write"
    assert not (tmp_path / "acc.jsonl.tmp").exists(), "partial temp file left behind"


def test_malformed_line_is_reported(tmp_path, capsys):
    p = tmp_path / "acc.jsonl"
    p.write_text(
        json.dumps(ROWS[0]) + "\n"
        + "{not json at all\n"
        + json.dumps(ROWS[1]) + "\n",
        encoding="utf-8",
    )

    rows = read_jsonl(str(p))
    err = capsys.readouterr().err

    assert len(rows) == 2
    assert "acc.jsonl:2" in err and "malformed JSON" in err, err


def test_upsert_replaces_by_date_and_keeps_sort(tmp_path):
    p = _seed(tmp_path)
    upsert_jsonl(str(p), {"date_iso": "2026-08-02", "term_30": 9.9})
    rows = read_jsonl(str(p))
    assert [r["date_iso"] for r in rows] == ["2026-08-01", "2026-08-02", "2026-08-03"]
    assert rows[1]["term_30"] == 9.9


def test_upsert_preserves_rows_without_the_key(tmp_path):
    """Three of the four original copies silently discarded these."""
    p = _seed(tmp_path, rows=ROWS + [{"note": "no date_iso here"}])
    upsert_jsonl(str(p), {"date_iso": "2026-08-04", "term_30": 6.8})
    rows = read_jsonl(str(p))
    assert any("note" in r for r in rows), "an un-keyed row was dropped"
    assert len(rows) == 5


def test_atomic_write_creates_missing_directories(tmp_path):
    p = tmp_path / "nested" / "deep" / "acc.jsonl"
    write_jsonl_atomic(str(p), ROWS)
    assert len(read_jsonl(str(p))) == 3


def test_all_four_fetchers_use_the_shared_writer(tmp_path):
    """Pins the consolidation itself: each fetcher's write_jsonl_idempotent
    must go through the atomic helper, so a future edit to one cannot quietly
    reintroduce the truncate-then-rewrite in three others."""
    for mod in (fetch_bankrate_state, fetch_mnd_state, fetch_nerdwallet_state):
        p = _seed(tmp_path, name=f"{mod.__name__}.jsonl")
        before = p.read_bytes()
        mod.write_jsonl_idempotent(str(p), {"date_iso": "2026-08-04", "term_30": 6.8})
        rows = read_jsonl(str(p))
        assert len(rows) == 4, mod.__name__
        assert before != p.read_bytes()


# ---- (c) Rocket's partial-row demotion + no-op rerun (W2.8) ----

COMPLETE = {"date_iso": "2026-08-01", "term_15": 5.9, "term_30": 6.5,
            "term_15_apr": 6.0, "term_30_apr": 6.6,
            "fetched_at_utc": "2026-08-01T10:00:00+00:00",
            "source": "rocket_live", "source_method": "static"}
PARTIAL = {"date_iso": "2026-08-01", "term_15": None, "term_30": 6.4,
           "term_15_apr": None, "term_30_apr": None,
           "fetched_at_utc": "2026-08-01T18:00:00+00:00",
           "source": "rocket_live", "source_method": "wayback_20260801"}


def test_partial_row_does_not_replace_a_complete_one(tmp_path):
    p = tmp_path / "rocket.jsonl"
    p.write_text(json.dumps(COMPLETE) + "\n", encoding="utf-8")

    fetch_rocket.write_jsonl_idempotent(str(p), PARTIAL)

    rows = read_jsonl(str(p))
    assert len(rows) == 1
    r = rows[0]
    assert r["term_15"] == 5.9, "a partial row destroyed the 15-yr value"
    assert r["term_30"] == 6.5, "a partial row demoted the 30-yr value"
    assert r["source_method"] == "static", "provenance was taken from the poorer row"


def test_partial_row_fills_only_missing_fields(tmp_path):
    p = tmp_path / "rocket.jsonl"
    half = dict(COMPLETE, term_15=None, term_15_apr=None)
    p.write_text(json.dumps(half) + "\n", encoding="utf-8")

    incoming = dict(PARTIAL, term_15=5.75, term_30=None, term_30_apr=None)
    fetch_rocket.write_jsonl_idempotent(str(p), incoming)

    r = read_jsonl(str(p))[0]
    assert r["term_15"] == 5.75, "a genuinely new value was not filled in"
    assert r["term_30"] == 6.5, "an existing value was overwritten with None"


def test_identical_rerun_leaves_the_file_untouched(tmp_path):
    p = tmp_path / "rocket.jsonl"
    p.write_text(json.dumps(COMPLETE) + "\n", encoding="utf-8")
    before = p.read_bytes()
    mtime = p.stat().st_mtime_ns

    # Same rates, later timestamp — the only thing a re-run changes.
    fetch_rocket.write_jsonl_idempotent(
        str(p), dict(COMPLETE, fetched_at_utc="2026-08-01T23:59:00+00:00"))

    assert p.read_bytes() == before, "an identical re-fetch dirtied the file"
    assert p.stat().st_mtime_ns == mtime


def test_genuinely_new_row_still_writes(tmp_path):
    p = tmp_path / "rocket.jsonl"
    p.write_text(json.dumps(COMPLETE) + "\n", encoding="utf-8")
    fetch_rocket.write_jsonl_idempotent(str(p), dict(COMPLETE, date_iso="2026-08-02"))
    assert len(read_jsonl(str(p))) == 2
