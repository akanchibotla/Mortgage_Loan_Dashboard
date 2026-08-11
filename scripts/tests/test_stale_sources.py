"""4.4 — the stale-source alarm must not be silenceable.

Two ways it used to be silenced, both of them by data the alarm was supposed
to be suspicious of:
  (a) ONE state carrying a future date won the cross-state max() and reported
      a negative age, which never trips `age > threshold`;
  (b) a Wayback salvage row is stamped with the SNAPSHOT's date, so a
      successful archive fetch cleared the "Rocket live feed is dead" alarm.
"""
import datetime as dt
import json
import os

import check_stale_sources as css

TODAY = dt.date(2026, 8, 10)
THIRTY_DAYS_AGO = (TODAY - dt.timedelta(days=30)).isoformat()


def _build_tree(tmp_path, bankrate_dates: dict[str, str], rocket_rows: list[dict]):
    """Lay out the minimal states/ + daily/ + data/ tree scan() reads."""
    states = tmp_path / "states"
    daily = tmp_path / "daily"
    data = tmp_path / "data"
    for p in (states, daily, data):
        p.mkdir(parents=True, exist_ok=True)

    for slug, date in bankrate_dates.items():
        d = states / slug
        d.mkdir(exist_ok=True)
        (d / "bankrate_30yr_daily.json").write_text(
            json.dumps([{"date": date, "rate": 6.5, "src": "Bankrate"}]), encoding="utf-8")
        # MND + NerdWallet kept fresh so they don't add noise to the findings.
        (d / "mnd_30yr_daily.json").write_text(
            json.dumps([{"date": TODAY.isoformat(), "rate": 6.5, "src": "MND"}]), encoding="utf-8")
        (daily / f"nerdwallet_{slug}.jsonl").write_text(
            json.dumps({"date_iso": TODAY.isoformat(), "term_30": 6.5}) + "\n", encoding="utf-8")

    with open(daily / "rocket.jsonl", "w", encoding="utf-8") as f:
        for r in rocket_rows:
            f.write(json.dumps(r) + "\n")

    # PMMS current, so it never appears in the findings we assert on.
    for term in (15, 30):
        (data / f"pmms_{term}yr_monthly.json").write_text(
            json.dumps([{"month": TODAY.strftime("%Y-%m"), "rate": 6.5, "n_weeks": 4}]),
            encoding="utf-8")

    return str(states), str(daily), str(data)


def _scan(tmp_path, bankrate_dates, rocket_rows):
    states, daily, data = _build_tree(tmp_path, bankrate_dates, rocket_rows)
    return css.scan(states, daily, data, TODAY, daily_threshold=8, pmms_threshold_months=2)


def _sources(findings, name):
    return [f for f in findings if f["source"] == name]


FRESH_ROCKET = [{"date_iso": TODAY.isoformat(), "term_30": 6.5, "source": "rocket_live",
                 "source_method": "static"}]


def test_future_date_in_one_state_does_not_silence_a_stale_source(tmp_path):
    """Scenario D: 50 states 30 days stale, one state dated 2099."""
    dates = {f"state-{i:02d}": THIRTY_DAYS_AGO for i in range(50)}
    dates["state-99"] = "2099-01-01"

    findings = _scan(tmp_path, dates, FRESH_ROCKET)
    bankrate = _sources(findings, "Bankrate")

    assert bankrate, "a 30-day-stale Bankrate must be reported despite the 2099 row"
    assert any("30 days old" in f["detail"] for f in bankrate), bankrate
    assert any("future-dated" in f["detail"] for f in bankrate), \
        "the corrupt row must itself be reported, not merely ignored"


def test_all_states_fresh_produces_no_bankrate_finding(tmp_path):
    """Control: the guard must not manufacture findings on healthy data."""
    dates = {f"state-{i:02d}": TODAY.isoformat() for i in range(5)}
    findings = _scan(tmp_path, dates, FRESH_ROCKET)
    assert _sources(findings, "Bankrate") == []


def test_fresh_wayback_row_does_not_clear_a_dead_rocket_feed(tmp_path):
    """Scenario: live feed last succeeded 30 days ago, today's row is archive."""
    dates = {f"state-{i:02d}": TODAY.isoformat() for i in range(5)}
    rocket = [
        {"date_iso": THIRTY_DAYS_AGO, "term_30": 6.5,
         "source": "rocket_live", "source_method": "static"},
        # The backfiller's provenance shape ...
        {"date_iso": (TODAY - dt.timedelta(days=1)).isoformat(), "term_30": 6.4,
         "source": "rocket_wayback", "source_method": "static"},
        # ... and the live fetcher's Tier-3 salvage shape.
        {"date_iso": TODAY.isoformat(), "term_30": 6.4,
         "source": "rocket_live", "source_method": "wayback_20260810"},
    ]

    findings = _sources(_scan(tmp_path, dates, rocket), "Rocket")

    assert findings, "a 30-day-dead live feed must be reported despite fresh archive rows"
    assert THIRTY_DAYS_AGO in findings[0]["detail"], findings


def test_live_row_today_clears_rocket(tmp_path):
    """Control: a genuine live fetch today must clear the alarm."""
    dates = {f"state-{i:02d}": TODAY.isoformat() for i in range(5)}
    rocket = [
        {"date_iso": THIRTY_DAYS_AGO, "term_30": 6.5,
         "source": "rocket_live", "source_method": "static"},
        {"date_iso": TODAY.isoformat(), "term_30": 6.4,
         "source": "rocket_live", "source_method": "static"},
    ]
    assert _sources(_scan(tmp_path, dates, rocket), "Rocket") == []


def test_only_wayback_rows_reports_no_live_rows(tmp_path):
    dates = {f"state-{i:02d}": TODAY.isoformat() for i in range(5)}
    rocket = [{"date_iso": TODAY.isoformat(), "term_30": 6.4,
               "source": "rocket_wayback", "source_method": "static"}]
    findings = _sources(_scan(tmp_path, dates, rocket), "Rocket")
    assert findings and "no live rows" in findings[0]["detail"], findings


def test_shipped_tree_is_scannable(repo_root):
    """Smoke: the real data must not trip the new corruption branch today."""
    findings = css.scan(
        os.path.join(repo_root, "src", "data", "states"),
        os.path.join(repo_root, "data", "daily"),
        os.path.join(repo_root, "src", "data"),
        dt.datetime.now(dt.UTC).date(),
        daily_threshold=8, pmms_threshold_months=2,
    )
    corrupt = [f for f in findings if "corruption" in f["detail"]]
    assert corrupt == [], f"shipped data has corrupt dates: {corrupt}"
