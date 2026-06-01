"""Fetch today's NC mortgage rates from Mortgage News Daily (MND).

MND embeds rate values directly in the page HTML (no client-side hydration),
so a single HTTP GET works. Appends one row per fetch to
data/daily/mnd_nc.jsonl (idempotent by date_iso = the page's stated date,
NOT the fetch date — MND updates only on business days).

Also writes a derived `src/data/mnd_nc_today.json` mirroring the latest row,
for backward-compat with any prior code paths.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import MND_JSONL, MND_TODAY_VIEW  # noqa: E402

URL = "https://www.mortgagenewsdaily.com/mortgage-rates/north-carolina"
JSONL_PATH = MND_JSONL
TODAY_VIEW = MND_TODAY_VIEW
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DEFAULTS_PAT = re.compile(r'data-default-fifteen="(\d\.\d+)"\s+data-default-thirty="(\d\.\d+)"')
DATE_PAT = re.compile(r'<div class="rate-date[^"]*"[^>]*>\s*(\d{1,2}/\d{1,2}/20\d{2})\s*</div>')


def parse_mnd_date(s: str) -> str | None:
    try:
        return dt.datetime.strptime(s, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def write_jsonl_idempotent(path: str, new_row: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing: list[dict] = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    existing.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    by_date = {r.get("date_iso"): r for r in existing if r.get("date_iso")}
    by_date[new_row["date_iso"]] = new_row
    merged = sorted(by_date.values(), key=lambda r: r.get("date_iso", ""))
    with open(path, "w", encoding="utf-8") as f:
        for r in merged:
            f.write(json.dumps(r) + "\n")


def write_today_view(row: dict) -> None:
    out = {
        "fetched_at_utc": row["fetched_at_utc"],
        "as_of_raw": row["as_of_raw"],
        "as_of_iso": row["date_iso"],
        "term_15": {"rate_pct": row["term_15"], "as_of_iso": row["date_iso"]},
        "term_30": {"rate_pct": row["term_30"], "as_of_iso": row["date_iso"]},
    }
    with open(TODAY_VIEW, "w") as f:
        json.dump(out, f, indent=2)


def main() -> int:
    req = urllib.request.Request(URL, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8", errors="ignore")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"ERROR: MND fetch failed: {e}", file=sys.stderr)
        return 2

    rates_m = DEFAULTS_PAT.search(text)
    date_m = DATE_PAT.search(text)
    if not rates_m:
        print("ERROR: rate values not found; MND page format may have changed.", file=sys.stderr)
        return 3

    rate_15 = float(rates_m.group(1))
    rate_30 = float(rates_m.group(2))
    as_of_raw = date_m.group(1) if date_m else None
    date_iso = parse_mnd_date(as_of_raw) if as_of_raw else dt.date.today().isoformat()

    row = {
        "date_iso": date_iso,
        "term_15": rate_15,
        "term_30": rate_30,
        "as_of_raw": as_of_raw,
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "source": "mnd_live",
    }
    print(f"  15-yr: {rate_15:.2f}%   30-yr: {rate_30:.2f}%   as_of: {as_of_raw} ({date_iso})")
    write_jsonl_idempotent(JSONL_PATH, row)
    write_today_view(row)
    print(f"Appended to {JSONL_PATH}")
    print(f"Mirrored to {TODAY_VIEW}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
