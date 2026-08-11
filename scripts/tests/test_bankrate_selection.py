"""4.1 — the Bankrate state-resolution collapse, and its whole class.

Since 2026-07-18 Bankrate's static HTML has served ONE national comparison
table on all 50 state URLs. Both readers preferred that `table_*` field over
the state-specific `intro_*` sitting in the very same record, so 48 of 51
states showed the identical rate for 24 days while the choropleth legend
advertised a spread that did not exist. Nothing alarmed, because every guard
asked "is the newest row recent?" and none asked "are these 51 numbers all
the same?".

Two layers of pin:
  - unit: both readers prefer intro_* and still fall back to table_*;
  - shipped data: the index actually varies across states.
"""
import collections
import datetime as dt
import glob
import json
import os

import emit_daily_view
import reconcile_state

TODAY = dt.date.today()
THIS_MONTH = TODAY.strftime("%Y-%m")


def _live_row(date_iso, *, intro=None, table=None):
    r = {"date_iso": date_iso, "fetched_at_utc": f"{date_iso}T12:00:00+00:00"}
    if intro is not None:
        r["intro_30"] = intro
        r["intro_15"] = intro - 0.6
    if table is not None:
        r["table_30"] = table
        r["table_15"] = table - 0.6
    return r


# ---- reconcile_state ----

def test_reconcile_prefers_intro_over_table():
    row = _live_row(TODAY.isoformat(), intro=6.42, table=6.76)
    rows = reconcile_state.reconcile_one("hawaii", 30, [], row, [row])
    current = [r for r in rows if r["m"] == THIS_MONTH]
    assert current and current[0]["rate"] == 6.42, current


def test_reconcile_falls_back_to_table_when_intro_absent():
    """~705 rows carry only `table`; they must still render."""
    row = _live_row(TODAY.isoformat(), table=6.76)
    rows = reconcile_state.reconcile_one("texas", 30, [], row, [row])
    current = [r for r in rows if r["m"] == THIS_MONTH]
    assert current and current[0]["rate"] == 6.76, current


def test_reconcile_rejects_the_placeholder_zero():
    """0.00 is the documented un-hydrated-placeholder failure mode, which is
    exactly why the precedence uses `or` and not `is None`."""
    row = _live_row(TODAY.isoformat(), intro=0.0, table=6.76)
    rows = reconcile_state.reconcile_one("texas", 30, [], row, [row])
    current = [r for r in rows if r["m"] == THIS_MONTH]
    assert current and current[0]["rate"] == 6.76, current


# ---- W2.7: live history, not just the trailing month ----

def _past_month_label(n_back: int) -> str:
    y, m = TODAY.year, TODAY.month - n_back
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


def test_live_history_fills_months_with_no_wayback_archive():
    """100 state-months rendered as `{"rate": null, "src": "no archive"}`
    while 28-31 daily observations for each sat in the JSONL."""
    last_month = _past_month_label(1)
    live_rows = [
        _live_row(f"{last_month}-05", intro=6.10),
        _live_row(f"{last_month}-20", intro=6.30),
        _live_row(f"{last_month}-28", intro=6.44),  # latest in month wins
    ]
    rows = reconcile_state.reconcile_one("north-carolina", 30, [], None, live_rows)
    got = [r for r in rows if r["m"] == last_month]
    assert got, f"{last_month} not in the window"
    assert got[0]["rate"] == 6.44, got
    assert got[0]["src"] == "Bankrate (live)", got
    assert got[0]["date"] == f"{last_month}-28", got


def test_live_beats_wayback_dense_for_a_covered_month():
    last_month = _past_month_label(1)
    dense = [{"month": last_month, "bankrate_table_pct": 5.00, "as_of": None}]
    live_rows = [_live_row(f"{last_month}-28", intro=6.44)]
    rows = reconcile_state.reconcile_one("north-carolina", 30, dense, None, live_rows)
    got = [r for r in rows if r["m"] == last_month][0]
    assert got["rate"] == 6.44 and got["src"] == "Bankrate (live)", got


def test_wayback_dense_still_used_where_there_is_no_live_row():
    old_month = _past_month_label(13)
    dense = [{"month": old_month, "bankrate_table_pct": 6.05, "as_of": None}]
    rows = reconcile_state.reconcile_one("north-carolina", 30, dense, None, [])
    got = [r for r in rows if r["m"] == old_month][0]
    assert got["rate"] == 6.05 and got["src"] == "Bankrate (Wayback)", got


def test_stale_gate_applies_to_the_current_month_only():
    """A stale tail must not be shown as today's rate — but a completed past
    month is settled history and its age is not a defect."""
    last_month = _past_month_label(1)
    # The stale tail is pinned to the 1st of the CURRENT month, not to
    # TODAY - 2 days. The relative form put the tail INSIDE last_month on the
    # 1st and 2nd of each calendar month, where it won live_by_month's
    # latest-in-month rule and failed the first assertion below. That is a
    # fixture bug, not a production bug — but this suite is a BLOCKING step in
    # refresh.yml ahead of every fetcher, so it would have aborted the daily
    # scrape for 51 states twice a month, losing same-day data that has no
    # backfill path. Caught by the post-fix validation, which ran the suite
    # under simulated dates: 2026-09-01, 2026-09-02 and 2026-10-01 all failed.
    live_rows = [
        _live_row(f"{last_month}-28", intro=6.44),
        _live_row(TODAY.replace(day=1).isoformat(), intro=6.90),
    ]
    # live=None models load_latest_live() having rejected the tail as stale.
    rows = reconcile_state.reconcile_one("north-carolina", 30, [], None, live_rows)
    by_m = {r["m"]: r for r in rows}
    assert by_m[last_month]["rate"] == 6.44, "a past month was gated on staleness"
    assert by_m[THIS_MONTH]["rate"] is None, "a stale tail was shown as the current rate"


# ---- emit_daily_view ----

def test_emit_bankrate_prefers_intro_and_records_the_field(tmp_path, monkeypatch):
    slug = "hawaii"
    daily = tmp_path / "daily"
    states = tmp_path / "states"
    daily.mkdir()
    (states / slug).mkdir(parents=True)

    jl = daily / f"bankrate_{slug}.jsonl"
    with open(jl, "w", encoding="utf-8") as f:
        f.write(json.dumps(_live_row(TODAY.isoformat(), intro=6.42, table=6.76)) + "\n")
        f.write(json.dumps(_live_row(
            (TODAY - dt.timedelta(days=1)).isoformat(), table=6.80)) + "\n")

    monkeypatch.setattr(emit_daily_view, "bankrate_jsonl", lambda s: str(jl))
    monkeypatch.setattr(emit_daily_view, "state_data_dir", lambda s: str(states / s))

    emit_daily_view.emit_bankrate(slug)

    out = json.load(open(states / slug / "bankrate_30yr_daily.json", encoding="utf-8"))
    by_date = {r["date"]: r for r in out}
    assert by_date[TODAY.isoformat()]["rate"] == 6.42
    assert by_date[TODAY.isoformat()]["field"] == "intro"
    fallback = by_date[(TODAY - dt.timedelta(days=1)).isoformat()]
    assert fallback["rate"] == 6.80 and fallback["field"] == "table"


# ---- shipped-data regression pin ----

def test_shipped_index_varies_across_states(repo_root):
    """The collapse itself, measured on what actually ships.

    Thresholds are set from the observed post-fix reality, not from an ideal:
    17 of 51 states still share one value because Bankrate publishes NO
    intro rate on those state pages at all (verified in the JSONL), so the
    table fallback is correct there. Before the fix it was 48 of 51 with only
    4 distinct values in the whole country.
    """
    idx = json.load(open(os.path.join(repo_root, "src", "data", "states_index.json"),
                        encoding="utf-8"))["states"]
    values = [s["latest_30"] for s in idx]
    counts = collections.Counter(values)
    modal_value, modal_n = counts.most_common(1)[0]

    assert len(values) >= 50, "index is unexpectedly small; the test would be weak"
    assert len(set(values)) >= 15, \
        f"only {len(set(values))} distinct latest_30 values across {len(values)} states"
    assert modal_n <= 20, \
        f"{modal_n}/{len(values)} states all report {modal_value} — the resolution collapsed again"


def test_shipped_rates_match_the_intro_field_where_it_exists(repo_root):
    """Direct pin on the precedence, computed from data rather than a magic
    number: wherever the latest live row HAS an intro_30, the shipped
    latest_30 must be that value, not the shared national table value."""
    idx = {s["slug"]: s for s in json.load(
        open(os.path.join(repo_root, "src", "data", "states_index.json"),
             encoding="utf-8"))["states"]}
    checked, wrong = 0, []
    for p in sorted(glob.glob(os.path.join(repo_root, "data", "daily", "bankrate_*.jsonl"))):
        slug = os.path.basename(p)[len("bankrate_"):-len(".jsonl")]
        if slug not in idx:
            continue
        rows = [json.loads(ln) for ln in open(p, encoding="utf-8") if ln.strip()]
        rows.sort(key=lambda r: r.get("date_iso", ""))
        last = rows[-1]
        intro = last.get("intro_30")
        if not intro:
            continue  # table fallback is correct for these
        checked += 1
        if idx[slug]["latest_30"] != intro:
            wrong.append((slug, idx[slug]["latest_30"], intro))
    assert checked >= 20, f"only {checked} states carry intro_30; pin too weak"
    assert wrong == [], f"shipped latest_30 does not match intro_30: {wrong[:5]}"


def test_no_covered_state_month_is_blank_where_jsonl_has_rows(repo_root):
    """W2.7's shipped-data half. The 2 remaining blanks are Washington DC,
    which has no Bankrate page at all — a coverage gap, not a defect."""
    blanks = []
    for p in sorted(glob.glob(os.path.join(
            repo_root, "src", "data", "states", "*", "bankrate_30yr.json"))):
        slug = os.path.basename(os.path.dirname(p))
        jsonl = os.path.join(repo_root, "data", "daily", f"bankrate_{slug}.jsonl")
        if not os.path.exists(jsonl):
            continue  # no live accumulator for this state (e.g. DC)
        months = {json.loads(ln)["date_iso"][:7]
                  for ln in open(jsonl, encoding="utf-8") if ln.strip()}
        for r in json.load(open(p, encoding="utf-8")):
            if r["rate"] is None and r["m"] in months:
                blanks.append((slug, r["m"]))
    assert blanks == [], f"months blank despite live observations on disk: {blanks[:10]}"


def test_dense_wayback_row_prefers_intro_over_table():
    """The archive branch must apply the same precedence as the live branch.

    The headline fix swapped intro-before-table in live_by_month and left the
    dense/Wayback branch reading bankrate_table_pct alone — the identical
    defect, one branch over in the same function. 66 archived state-months
    carry an intro value and NO table value, so they were emitted as
    "no archive" despite a usable rate in the record.
    """
    old_month = _past_month_label(13)
    dense = [{
        "month": old_month,
        "bankrate_table_pct": 6.05,
        "bankrate_intro_pct": 6.44,
        "as_of": None,
    }]
    rows = reconcile_state.reconcile_one("north-carolina", 30, dense, None, [])
    got = [r for r in rows if r["m"] == old_month][0]
    assert got["rate"] == 6.44, f"dense branch used the national table value: {got}"


def test_intro_only_dense_row_is_no_longer_dropped():
    """North Dakota's real shape: every archived month is intro-only, so its
    ENTIRE Wayback history rendered as "no archive" before this fix."""
    old_month = _past_month_label(13)
    dense = [{
        "month": old_month,
        "bankrate_table_pct": None,
        "bankrate_intro_pct": 6.93,
        "as_of": None,
    }]
    rows = reconcile_state.reconcile_one("north-dakota", 30, dense, None, [])
    got = [r for r in rows if r["m"] == old_month][0]
    assert got["rate"] == 6.93 and got["src"] == "Bankrate (Wayback)", got


def test_month_uses_its_latest_INTRO_row_not_merely_its_latest_row():
    """Precedence is applied across the month, not just inside the winning row.

    Maine 2026-07 is the real fixture: 29 state-specific intro observations,
    then the intro feed stops and the month's final rows carry only the shared
    national table value. Taking the latest row first published the national
    number for the whole month — the headline defect, one level up.
    """
    last_month = _past_month_label(1)
    live_rows = [
        _live_row(f"{last_month}-10", intro=6.80),
        # Later in the SAME month, intro has gone away; only the national
        # table value remains.
        {"date_iso": f"{last_month}-30", "table_30": 6.76, "intro_30": None},
    ]
    rows = reconcile_state.reconcile_one("north-carolina", 30, [], None, live_rows)
    got = [r for r in rows if r["m"] == last_month][0]
    assert got["rate"] == 6.80, f"published the shared national value for the month: {got}"


def test_month_with_no_intro_at_all_still_falls_back_to_table():
    """Control: 17 states genuinely carry no intro_* in the current month, and
    the national table is the only number available. The fix must not turn
    those months into holes."""
    last_month = _past_month_label(1)
    live_rows = [
        {"date_iso": f"{last_month}-10", "table_30": 6.70, "intro_30": None},
        {"date_iso": f"{last_month}-28", "table_30": 6.76, "intro_30": None},
    ]
    rows = reconcile_state.reconcile_one("north-carolina", 30, [], None, live_rows)
    got = [r for r in rows if r["m"] == last_month][0]
    assert got["rate"] == 6.76, f"table fallback lost: {got}"
