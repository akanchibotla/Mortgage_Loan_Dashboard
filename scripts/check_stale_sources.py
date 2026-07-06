"""Detect a *systemically* stale data source and emit an alert the workflow
can turn into a GitHub issue.

WHY THIS EXISTS
  The Rocket feed silently froze for ~4 weeks (2026-06-03 -> 2026-07-05) and
  nobody noticed, because the daily refresh's fail-soft design only opens an
  issue when the whole JOB fails. A single permanently-broken component keeps
  the job green (it just logs a per-source failure), so the break is visible
  only as a "(partial: N failure(s))" tag in commit messages — easy to scroll
  past for weeks.

WHAT IT CATCHES (and what it deliberately doesn't)
  For each source it finds the FRESHEST last-observation across ALL states.
  If even the freshest row is older than the threshold, the *entire source*
  is down — that's the systemic outage worth an issue. One flaky state does
  not trip it (some other state is still fresh), because per-state flakiness
  is already surfaced by the existing "Validate daily coverage" warnings and
  self-heals on the next run. This guard is the long-silence backstop, not a
  second per-state nag.

USAGE
  python scripts/check_stale_sources.py [--today YYYY-MM-DD]
        [--daily-threshold-days 8] [--pmms-threshold-days 62]
        [--alert-file .stale-alert.txt]
  Exit code is always 0 (advisory). If any source is systemically stale it
  writes <alert-file> with a human-readable summary; the workflow opens/updates
  a de-duplicated issue when that file is present and non-empty.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import DAILY_DIR, DATA_DIR, STATES_DIR  # noqa: E402


def _last_date_json_array(path: str, key: str) -> str | None:
    """Return the last element's `key` from a JSON-array file, or None."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            arr = json.load(f)
        if isinstance(arr, list) and arr:
            v = arr[-1].get(key)
            return v or None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return None


def _last_date_jsonl(path: str, key: str) -> str | None:
    """Return the last non-blank line's `key` from a JSONL file, or None."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = [ln for ln in f if ln.strip()]
        if lines:
            return json.loads(lines[-1]).get(key) or None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return None


def _freshest(dates: list[str]) -> str | None:
    """Max ISO date string (lexicographic == chronological for YYYY-MM-DD)."""
    valid = [d for d in dates if d]
    return max(valid) if valid else None


def _age_days(iso_date: str, today: dt.date) -> int | None:
    try:
        d = dt.date.fromisoformat(iso_date)
    except ValueError:
        return None
    return (today - d).days


def _months_behind(month_str: str, today: dt.date) -> int | None:
    """Whole calendar months between a 'YYYY-MM' string and today's month."""
    try:
        y, m = int(month_str[0:4]), int(month_str[5:7])
    except (ValueError, IndexError):
        return None
    return (today.year - y) * 12 + (today.month - m)


def scan(root_states: str, daily_dir: str, data_dir: str, today: dt.date,
         daily_threshold: int, pmms_threshold_days: int) -> list[dict]:
    """Return a list of stale-source findings (empty == all healthy)."""
    slugs = sorted(
        d for d in os.listdir(root_states)
        if os.path.isdir(os.path.join(root_states, d))
    ) if os.path.isdir(root_states) else []

    findings: list[dict] = []

    # ---- Per-state daily quote sources: freshest across all states ----
    per_state = {
        "Bankrate": [
            _last_date_json_array(
                os.path.join(root_states, s, "bankrate_30yr_daily.json"), "date")
            for s in slugs
        ],
        "MND": [
            _last_date_json_array(
                os.path.join(root_states, s, "mnd_30yr_daily.json"), "date")
            for s in slugs
        ],
        "NerdWallet": [
            _last_date_jsonl(
                os.path.join(daily_dir, f"nerdwallet_{s}.jsonl"), "date_iso")
            for s in slugs
        ],
    }
    for name, dates in per_state.items():
        fresh = _freshest(dates)
        if fresh is None:
            findings.append({"source": name, "detail": "no dated rows on disk at all"})
            continue
        age = _age_days(fresh, today)
        if age is not None and age > daily_threshold:
            findings.append({
                "source": name,
                "detail": f"freshest row across all states is {fresh} ({age} days old)",
            })

    # ---- Rocket: single national JSONL ----
    rk = _last_date_jsonl(os.path.join(daily_dir, "rocket.jsonl"), "date_iso")
    if rk is None:
        findings.append({"source": "Rocket", "detail": "no rows in rocket.jsonl"})
    else:
        age = _age_days(rk, today)
        if age is not None and age > daily_threshold:
            findings.append({
                "source": "Rocket",
                "detail": f"last national row is {rk} ({age} days old)",
            })

    # ---- PMMS 30/15-yr national monthly ----
    for term in (30, 15):
        pf = os.path.join(data_dir, f"pmms_{term}yr_monthly.json")
        last_month = _last_date_json_array(pf, "month")
        if last_month is None:
            findings.append({"source": f"PMMS {term}yr", "detail": "no monthly rows"})
            continue
        mb = _months_behind(last_month, today)
        # Convert the month gap to an approximate day age for a single knob.
        if mb is not None and mb * 30 > pmms_threshold_days:
            findings.append({
                "source": f"PMMS {term}yr",
                "detail": f"last month is {last_month} ({mb} months behind)",
            })

    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=None, help="override today (YYYY-MM-DD, UTC)")
    ap.add_argument("--daily-threshold-days", type=int, default=8)
    ap.add_argument("--pmms-threshold-days", type=int, default=62)
    ap.add_argument("--alert-file", default=".stale-alert.txt")
    ap.add_argument("--states-dir", default=STATES_DIR)
    ap.add_argument("--daily-dir", default=DAILY_DIR)
    ap.add_argument("--data-dir", default=DATA_DIR)
    args = ap.parse_args()

    today = dt.date.fromisoformat(args.today) if args.today else dt.datetime.now(dt.UTC).date()

    findings = scan(
        args.states_dir, args.daily_dir, args.data_dir, today,
        args.daily_threshold_days, args.pmms_threshold_days,
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
        lines.append(f"- **{f['source']}** — {f['detail']}")
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
