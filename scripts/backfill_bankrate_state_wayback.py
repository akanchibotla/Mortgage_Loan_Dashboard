"""One-shot backfill of a state's Bankrate Wayback snapshots.

CDX-queries Wayback for the state's Bankrate page over the chart window;
picks the snapshot closest to mid-month per calendar month; extracts both
terms' table rates; writes
  src/data/states/{slug}/bankrate_{15,30}yr_dense.json

Polite: 2-second sleep between fetches; retry on 503/timeout.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import state_data_dir  # noqa: E402
from states import by_slug  # noqa: E402

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in"
)


def cdx_url(slug: str, from_ymd: str, to_ymd: str) -> str:
    target = f"bankrate.com/mortgages/mortgage-rates/{slug}/"
    return (
        f"http://web.archive.org/cdx/search/cdx?url={target}"
        f"&from={from_ymd}&to={to_ymd}&filter=statuscode:200&output=json"
        "&collapse=timestamp:8"
    )


def http_get(url: str, timeout: int = 60, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            wait = 4 * (attempt + 1)
            print(f"    retry {attempt + 1}/{retries} after {e} (sleep {wait}s)")
            time.sleep(wait)
    return None


def closest_to_mid(month: tuple[int, int], snaps: list[dict]) -> dict | None:
    target = dt.date(month[0], month[1], 15)
    best, best_delta = None, None
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
            best, best_delta = s, delta
    return best


# Bankrate rate-table row pattern. The page evolved across our window; this
# matches the older <th> layout and the newer <div>/td layout.
TABLE_OLD = lambda term: re.compile(
    rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</th>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
    re.IGNORECASE,
)
TABLE_NEW = lambda term: re.compile(
    rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</div>\s*</td>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
    re.IGNORECASE,
)
INTRO = lambda term: re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def extract_rates(html: str) -> dict:
    out: dict = {}
    for term in (15, 30):
        m = TABLE_OLD(term).search(html) or TABLE_NEW(term).search(html)
        i = INTRO(term).search(html)
        out[f"table_{term}"] = float(m.group(1)) if m else None
        out[f"intro_{term}"] = float(i.group(1)) if i else None
    date_m = DATE_INTRO_PAT.search(html)
    out["as_of"] = date_m.group(1) if date_m else None
    return out


def backfill(slug: str, from_year: int = 2024, from_month: int = 6) -> int:
    state = by_slug(slug)
    from_ymd = f"{from_year:04d}{from_month:02d}01"
    to_ymd = dt.date.today().strftime("%Y%m%d")

    print(f"Querying CDX for {slug}...")
    cdx = http_get(cdx_url(slug, from_ymd, to_ymd), timeout=90, retries=4)
    if not cdx:
        print(f"  CDX failed; aborting {slug}.")
        return 1
    try:
        data = json.loads(cdx)
    except json.JSONDecodeError:
        print("  CDX returned non-JSON")
        return 1
    if not data:
        print(f"  No snapshots found for {slug}.")
        # Write empty dense files so reconcile doesn't blow up.
        out_dir = state_data_dir(slug)
        os.makedirs(out_dir, exist_ok=True)
        for term in (15, 30):
            with open(os.path.join(out_dir, f"bankrate_{term}yr_dense.json"), "w") as f:
                json.dump([], f)
        return 0
    header, *rows = data
    snaps = [dict(zip(header, r)) for r in rows]
    print(f"  {len(snaps)} candidate snapshots")

    # Walk months in window
    months: list[tuple[int, int]] = []
    y, m = from_year, from_month
    today = dt.date.today()
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1

    results_15: list[dict] = []
    results_30: list[dict] = []
    for ym in months:
        s = closest_to_mid(ym, snaps)
        label = f"{ym[0]}-{ym[1]:02d}"
        if not s:
            print(f"  {label}  no snapshot in CDX")
            continue
        ts = s["timestamp"]
        wb_url = f"https://web.archive.org/web/{ts}/{s['original']}"
        print(f"  {label}  fetching {ts}", end=" ", flush=True)
        html = http_get(wb_url, timeout=60, retries=2)
        if not html:
            print("FAIL")
            time.sleep(2)
            continue
        ext = extract_rates(html)
        t15, t30 = ext["table_15"], ext["table_30"]
        i15, i30 = ext["intro_15"], ext["intro_30"]
        print(f"  table 15={t15} 30={t30}  intro 15={i15} 30={i30}")
        row_meta = {
            "month": label,
            "as_of": ext["as_of"],
            "wayback_timestamp": ts,
        }
        results_15.append({**row_meta, "bankrate_table_pct": t15, "bankrate_intro_pct": i15})
        results_30.append({**row_meta, "bankrate_table_pct": t30, "bankrate_intro_pct": i30})
        time.sleep(2)

    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "bankrate_15yr_dense.json"), "w") as f:
        json.dump(results_15, f, indent=2)
    with open(os.path.join(out_dir, "bankrate_30yr_dense.json"), "w") as f:
        json.dump(results_30, f, indent=2)
    n15 = sum(1 for r in results_15 if r.get("bankrate_table_pct"))
    n30 = sum(1 for r in results_30 if r.get("bankrate_table_pct"))
    print(f"\n{state['name']}: wrote {n15} 15-yr + {n30} 30-yr Wayback entries")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", required=True)
    args = parser.parse_args()
    return backfill(args.state)


if __name__ == "__main__":
    sys.exit(main())
