"""One-shot backfill of historical Mortgage News Daily NC values via Wayback.

Queries the Wayback CDX index for snapshots of the MND NC page covering the
chart window (Jun 2024 -> today), picks the snapshot nearest the 15th of each
calendar month, and extracts both terms via the same data-default-* regex
the live fetcher uses. Appends rows to data/daily/mnd_nc.jsonl with
source="mnd_wayback".

Best-effort: Wayback CDX is known-flaky; partial coverage is acceptable.
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import MND_JSONL  # noqa: E402

JSONL_PATH = MND_JSONL
TARGET_URL = "mortgagenewsdaily.com/mortgage-rates/north-carolina"
CDX_URL = "http://web.archive.org/cdx/search/cdx"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Same regex as fetch_mnd_nc.py
DEFAULTS_PAT = re.compile(
    r'data-default-fifteen="(\d\.\d+)"\s+data-default-thirty="(\d\.\d+)"'
)
DATE_PAT = re.compile(
    r'<div class="rate-date[^"]*"[^>]*>\s*(\d{1,2}/\d{1,2}/20\d{2})\s*</div>'
)


def http_get(url: str, timeout: int = 60, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            wait = 4 * (attempt + 1)
            print(f"  retry {attempt + 1}/{retries} after {e} (sleep {wait}s)")
            time.sleep(wait)
    return None


def query_cdx(from_ymd: str, to_ymd: str) -> list[dict]:
    url = (
        f"{CDX_URL}?url={TARGET_URL}&from={from_ymd}&to={to_ymd}"
        "&filter=statuscode:200&output=json&collapse=timestamp:8"
    )
    print(f"CDX: {url}")
    raw = http_get(url, timeout=90, retries=4)
    if not raw:
        print("CDX query failed; backfill will be empty.")
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("CDX returned non-JSON")
        return []
    if not data:
        return []
    header, *rows = data
    return [dict(zip(header, r)) for r in rows]


def closest_to_mid(month: tuple[int, int], snaps: list[dict]) -> dict | None:
    target = dt.date(month[0], month[1], 15)
    best = None
    best_delta = None
    for s in snaps:
        ts = s.get("timestamp", "")
        if len(ts) < 8:
            continue
        try:
            d = dt.date(int(ts[0:4]), int(ts[4:6]), int(ts[6:8]))
        except ValueError:
            continue
        if (d.year, d.month) != month:
            continue
        delta = abs((d - target).days)
        if best is None or delta < best_delta:  # type: ignore[operator]
            best = s
            best_delta = delta
    return best


def extract(html: str) -> tuple[float | None, float | None, str | None]:
    rates = DEFAULTS_PAT.search(html)
    date = DATE_PAT.search(html)
    if not rates:
        return None, None, None
    return float(rates.group(1)), float(rates.group(2)), (date.group(1) if date else None)


def parse_mnd_date(s: str | None) -> str | None:
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def write_jsonl_idempotent(path: str, rows: list[dict]) -> int:
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
    # Dedupe by date_iso: new rows replace any existing same-date row.
    by_date = {r.get("date_iso"): r for r in existing if r.get("date_iso")}
    added = 0
    for r in rows:
        if r.get("date_iso") and r["date_iso"] not in by_date:
            added += 1
        by_date[r["date_iso"]] = r
    merged = sorted(by_date.values(), key=lambda r: r.get("date_iso", ""))
    with open(path, "w", encoding="utf-8") as f:
        for r in merged:
            f.write(json.dumps(r) + "\n")
    return added


def main() -> int:
    from_ymd = "20240601"
    to_ymd = dt.date.today().strftime("%Y%m%d")
    snaps = query_cdx(from_ymd, to_ymd)
    print(f"CDX returned {len(snaps)} candidate snapshots")
    if not snaps:
        return 1

    # Walk months in window; pick closest-to-15th snapshot per month.
    months: list[tuple[int, int]] = []
    y, m = 2024, 6
    today = dt.date.today()
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1

    rows: list[dict] = []
    for ym in months:
        s = closest_to_mid(ym, snaps)
        if not s:
            print(f"  {ym[0]}-{ym[1]:02d}  no snapshot in CDX")
            continue
        ts = s["timestamp"]
        wb_url = f"https://web.archive.org/web/{ts}/{s['original']}"
        print(f"  {ym[0]}-{ym[1]:02d}  fetching {ts}", end=" ", flush=True)
        html = http_get(wb_url, timeout=60, retries=3)
        if not html:
            print("FAIL")
            time.sleep(2)
            continue
        r15, r30, raw_date = extract(html)
        date_iso = parse_mnd_date(raw_date) or f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]}"
        if r15 is None or r30 is None:
            print(f"no rates in HTML (date={raw_date})")
        else:
            print(f"15={r15:.2f} 30={r30:.2f} date={raw_date}")
            rows.append({
                "date_iso": date_iso,
                "term_15": r15,
                "term_30": r30,
                "as_of_raw": raw_date,
                "wayback_timestamp": ts,
                "source": "mnd_wayback",
            })
        time.sleep(2)  # polite

    added = write_jsonl_idempotent(JSONL_PATH, rows)
    print(f"\nWrote {len(rows)} rows ({added} new) -> {JSONL_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
