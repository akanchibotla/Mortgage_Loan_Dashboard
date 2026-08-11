"""Detect a *systemically* stale data source and emit an alert the workflow
can turn into a GitHub issue.

WHY THIS EXISTS
  The Rocket feed silently froze for ~4 weeks (2026-06-03 -> 2026-07-05) and
  nobody noticed, because the daily refresh's fail-soft design only opens an
  issue when the whole JOB fails. A single permanently-broken component keeps
  the job green (it just logs a per-source failure), so the break is visible
  only as a "(partial: N failure(s))" tag in commit messages -- easy to scroll
  past for weeks.

WHAT IT CATCHES (and what it deliberately doesn't)
  For each source it finds the FRESHEST last-observation across ALL states.
  If even the freshest row is older than the threshold, the *entire source*
  is down -- that's the systemic outage worth an issue. One flaky state does
  not trip it (some other state is still fresh), because per-state flakiness
  is already surfaced by the existing "Validate daily coverage" warnings and
  self-heals on the next run. This guard is the long-silence backstop, not a
  second per-state nag.

  A date that is present but UNPARSEABLE or in the FUTURE (data corruption)
  is treated as an alert, not silently ignored -- a garbage value must never
  mask a dead source, and a future date would otherwise win the max() and
  report a negative age that never trips the threshold.

  Rocket freshness is measured over LIVE rows only. A Wayback salvage row is
  written with the snapshot's own date, so counting it would let the archive
  workaround clear the very alarm that says the live feed is dead.

USAGE
  python scripts/check_stale_sources.py [--today YYYY-MM-DD]
        [--daily-threshold-days 8] [--pmms-threshold-months 2]
        [--alert-file .stale-alert.txt]
  Exit code is always 0 (advisory). If any source is systemically stale it
  writes <alert-file> with a human-readable summary; the workflow opens/updates
  a de-duplicated issue when that file is present and non-empty.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import DAILY_DIR, DATA_DIR, STATES_DIR  # noqa: E402


def _is_iso_date(s: object) -> bool:
    """True only for a real YYYY-MM-DD calendar date."""
    if not isinstance(s, str):
        return False
    try:
        dt.date.fromisoformat(s)
        return True
    except ValueError:
        return False


def _last_value_json_array(path: str, key: str) -> object | None:
    """Return the last element's `key` from a JSON-array file, or None.

    Returns the raw value (which may be malformed) so the caller can tell
    'no row' (None) apart from 'row present but date is garbage' (non-None,
    non-ISO) -- the latter must alert, not be silently dropped.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            arr = json.load(f)
        if isinstance(arr, list) and arr:
            v = arr[-1].get(key)
            return v if v not in (None, "") else None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return None


def _last_value_jsonl(path: str, key: str) -> object | None:
    """Return the last non-blank line's `key` from a JSONL file, or None."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = [ln for ln in f if ln.strip()]
        if lines:
            v = json.loads(lines[-1]).get(key)
            return v if v not in (None, "") else None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return None


def _is_wayback_row(row: dict) -> bool:
    """True when a Rocket row was salvaged from the Internet Archive rather
    than fetched live. The backfiller stamps source="rocket_wayback"; the live
    fetcher's Tier-3 salvage stamps source_method="wayback_<YYYYMMDD>"."""
    return (row.get("source") == "rocket_wayback") or \
        str(row.get("source_method") or "").startswith("wayback")


def _last_live_value_jsonl(path: str, key: str) -> object | None:
    """Like _last_value_jsonl, but for Rocket: skip Wayback salvage rows.

    WHY: an archive row is written with the SNAPSHOT's date, so a successful
    Wayback salvage lands a fresh-looking row and clears this alarm -- exactly
    the condition the alarm exists to catch. Rocket's live feed being dead is
    the finding; the archive row is the workaround, not the recovery.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, json.JSONDecodeError):
        return None
    live = [r for r in rows if isinstance(r, dict) and not _is_wayback_row(r)]
    if not live:
        return None
    # The file is date-sorted on write, but backfills can interleave, so take
    # the max explicitly rather than trusting the tail. Only ISO values are
    # eligible for the max -- a garbage string would otherwise sort above real
    # dates and mask staleness. If nothing parses, hand back a raw value so the
    # caller reports corruption instead of "no rows".
    present = [r.get(key) for r in live if r.get(key) not in (None, "")]
    valid = [v for v in present if _is_iso_date(v)]
    if valid:
        return max(valid)
    return present[0] if present else None


def _freshest(dates: list[object], today: dt.date) -> tuple[str | None, bool]:
    """Return (freshest_valid_ISO_date_or_None, saw_unparseable).

    Non-ISO / malformed values are dropped from the max() (a garbage string
    like 'corrupted' would otherwise sort lexicographically above real dates
    and then fail age parsing, silently masking staleness) -- but the fact
    that a malformed value was seen is reported back so the caller can alert
    on corruption rather than swallow it.

    A date in the FUTURE is corruption too, and the more dangerous kind: a
    single '2099-01-01' row in ONE state used to win the max() and report a
    negative age, which never trips `age > threshold` -- so one bad row could
    silence a 30-day-dead source across all 51 states. Future dates are
    therefore excluded from the max() and reported as corruption.
    """
    valid = [d for d in dates if _is_iso_date(d) and dt.date.fromisoformat(d) <= today]
    saw_bad = any(
        d is not None
        and (not _is_iso_date(d) or dt.date.fromisoformat(d) > today)
        for d in dates
    )
    return (max(valid) if valid else None), saw_bad


def _age_days(iso_date: str, today: dt.date) -> int | None:
    try:
        d = dt.date.fromisoformat(iso_date)
    except ValueError:
        return None
    return (today - d).days


def _months_behind(month_str: object, today: dt.date) -> int | None:
    """Whole calendar months between a strict 'YYYY-MM' string and today's
    month. Returns None for anything not exactly YYYY-MM (so corruption is
    detectable, not silently parsed)."""
    if not isinstance(month_str, str) or len(month_str) != 7 or month_str[4] != "-":
        return None
    try:
        y, m = int(month_str[0:4]), int(month_str[5:7])
    except ValueError:
        return None
    if not 1 <= m <= 12:
        return None
    return (today.year - y) * 12 + (today.month - m)


def scan(root_states: str, daily_dir: str, data_dir: str, today: dt.date,
         daily_threshold: int, pmms_threshold_months: int) -> list[dict]:
    """Return a list of stale-source findings (empty == all healthy)."""
    slugs = sorted(
        d for d in os.listdir(root_states)
        if os.path.isdir(os.path.join(root_states, d))
    ) if os.path.isdir(root_states) else []

    findings: list[dict] = []

    # ---- Per-state daily quote sources: freshest across all states ----
    per_state = {
        "Bankrate": [
            _last_value_json_array(
                os.path.join(root_states, s, "bankrate_30yr_daily.json"), "date")
            for s in slugs
        ],
        "MND": [
            _last_value_json_array(
                os.path.join(root_states, s, "mnd_30yr_daily.json"), "date")
            for s in slugs
        ],
        "NerdWallet": [
            _last_value_jsonl(
                os.path.join(daily_dir, f"nerdwallet_{s}.jsonl"), "date_iso")
            for s in slugs
        ],
    }
    for name, dates in per_state.items():
        fresh, saw_bad = _freshest(dates, today)
        if fresh is None:
            detail = ("all rows have unparseable dates (data corruption)"
                      if saw_bad else "no dated rows on disk at all")
            findings.append({"source": name, "detail": detail})
            continue
        if saw_bad:
            # A bad value no longer masks staleness (it is out of the max()),
            # but it is still corruption and must be said out loud.
            findings.append({
                "source": name,
                "detail": "at least one state has an unparseable or future-dated "
                          "row (data corruption); it was excluded from the "
                          "freshness check",
            })
        age = _age_days(fresh, today)
        if age is not None and age > daily_threshold:
            findings.append({
                "source": name,
                "detail": f"freshest row across all states is {fresh} ({age} days old)",
            })

    # ---- Rocket: single national JSONL ----
    rk = _last_live_value_jsonl(os.path.join(daily_dir, "rocket.jsonl"), "date_iso")
    if rk is None:
        findings.append({"source": "Rocket", "detail": "no live rows in rocket.jsonl"})
    else:
        age = _age_days(rk, today)
        if age is None:
            findings.append({
                "source": "Rocket",
                "detail": f"last live national row has an unparseable date {rk!r} (data corruption)",
            })
        elif age > daily_threshold:
            findings.append({
                "source": "Rocket",
                "detail": f"last LIVE national row is {rk} ({age} days old); Wayback salvage rows are excluded",
            })

    # ---- PMMS 30/15-yr national monthly ----
    for term in (30, 15):
        pf = os.path.join(data_dir, f"pmms_{term}yr_monthly.json")
        last_month = _last_value_json_array(pf, "month")
        if last_month is None:
            findings.append({"source": f"PMMS {term}yr", "detail": "no monthly rows"})
            continue
        mb = _months_behind(last_month, today)
        if mb is None:
            findings.append({
                "source": f"PMMS {term}yr",
                "detail": f"last month is unparseable {last_month!r} (data corruption)",
            })
        elif mb > pmms_threshold_months:
            findings.append({
                "source": f"PMMS {term}yr",
                "detail": f"last month is {last_month} ({mb} months behind)",
            })

    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=None, help="override today (YYYY-MM-DD, UTC)")
    ap.add_argument("--daily-threshold-days", type=int, default=8)
    ap.add_argument("--pmms-threshold-months", type=int, default=2)
    ap.add_argument("--alert-file", default=".stale-alert.txt")
    ap.add_argument("--states-dir", default=STATES_DIR)
    ap.add_argument("--daily-dir", default=DAILY_DIR)
    ap.add_argument("--data-dir", default=DATA_DIR)
    args = ap.parse_args()

    if args.today:
        try:
            today = dt.date.fromisoformat(args.today)
        except ValueError:
            print(f"--today must be YYYY-MM-DD, got {args.today!r}", file=sys.stderr)
            return 2
    else:
        today = dt.datetime.now(dt.UTC).date()

    findings = scan(
        args.states_dir, args.daily_dir, args.data_dir, today,
        args.daily_threshold_days, args.pmms_threshold_months,
    )

    if not findings:
        print(f"check_stale_sources: all sources fresh as of {today} "
              f"(daily<= {args.daily_threshold_days}d).")
        # Remove any stale alert file from a previous run so a recovered
        # source doesn't keep re-triggering the issue step.
        if os.path.exists(args.alert_file):
            os.remove(args.alert_file)
        return 0

    lines = [f"Systemically stale data source(s) detected on {today} (UTC):", ""]
    for f in findings:
        lines.append(f"- **{f['source']}** -- {f['detail']}")
    lines += [
        "",
        "A source is flagged only when its *freshest* observation across all "
        "states is past threshold, i.e. the whole source is down (not one "
        "flaky state). See the run's \"Validate daily coverage\" step for the "
        "per-state breakdown.",
    ]
    report = "\n".join(lines)
    print(report)
    with open(args.alert_file, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
