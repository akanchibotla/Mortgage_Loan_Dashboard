"""One-shot Wayback backfill of Rocket Mortgage's national rate page.

CDX-queries Wayback for https://www.rocketmortgage.com/mortgage-rates over
a configurable window (default 2020-01-01 -> today), picks the closest-to-
mid-month snapshot per calendar month, runs the shared extract() from
fetch_rocket.py against the archived HTML, and merges rows into
data/daily/rocket.jsonl with source="rocket_wayback".

Reality: Rocket's pre-2024 pages were JS-rendered and Wayback captured
only the page shell, so those snapshots yield nothing extractable. The
fetcher logs "no-extract" for them and moves on; only months where the
rate card is actually present in the static HTML produce rows. In
practice that's late-2024 onward.

Live > Wayback on date collisions, mirroring backfill_nerdwallet_state_wayback.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import rocket_jsonl  # noqa: E402
from fetch_rocket import HEADERS, _strip_html, extract  # noqa: E402

CDX_URL = "http://web.archive.org/cdx/search/cdx"
TARGET = "rocketmortgage.com/mortgage-rates"


def http_get(url: str, timeout: int = 60, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            wait = 4 * (attempt + 1)
            print(f"    retry {attempt + 1}/{retries} after {e} (sleep {wait}s)", flush=True)
            time.sleep(wait)
    return None


def query_cdx(from_ymd: str, to_ymd: str) -> list[dict]:
    url = (
        f"{CDX_URL}?url={TARGET}&from={from_ymd}&to={to_ymd}"
        "&filter=statuscode:200&output=json&collapse=timestamp:8"
    )
    raw = http_get(url, timeout=90, retries=4)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not data:
        return []
    header, *rows = data
    return [dict(zip(header, r)) for r in rows]


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


def month_range(from_year: int, from_month: int, until: dt.date) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, m = from_year, from_month
    while (y, m) <= (until.year, until.month):
        out.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1
    return out


def write_jsonl_merge(path: str, new_rows: list[dict]) -> tuple[int, int]:
    """Merge by date_iso. Live wins over wayback on collisions."""
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
    added = replaced = 0
    for r in new_rows:
        d = r.get("date_iso")
        if not d:
            continue
        cur = by_date.get(d)
        if cur is None:
            by_date[d] = r
            added += 1
            continue
        if cur.get("source") == "rocket_live" and r.get("source") == "rocket_wayback":
            continue
        if cur.get("source") == "rocket_wayback" and r.get("source") == "rocket_live":
            by_date[d] = r
            replaced += 1
            continue
        if (r.get("fetched_at_utc") or "") > (cur.get("fetched_at_utc") or ""):
            by_date[d] = r
            replaced += 1
    with open(path, "w", encoding="utf-8") as f:
        for r in sorted(by_date.values(), key=lambda r: r.get("date_iso", "")):
            f.write(json.dumps(r) + "\n")
    return added, replaced


def backfill(from_year: int = 2020, from_month: int = 1, delay: float = 2.0) -> int:
    today = dt.date.today()
    from_ymd = f"{from_year:04d}{from_month:02d}01"
    to_ymd = today.strftime("%Y%m%d")
    print(f"=== Rocket Mortgage Wayback backfill — {from_ymd}..{to_ymd} ===")
    snaps = query_cdx(from_ymd, to_ymd)
    if not snaps:
        print("CDX returned no snapshots; aborting.")
        return 1
    print(f"  {len(snaps)} CDX rows")

    rows: list[dict] = []
    miss_no_snap = miss_no_extract = 0
    fetched_at = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    for ym in month_range(from_year, from_month, today):
        label = f"{ym[0]}-{ym[1]:02d}"
        s = closest_to_mid(ym, snaps)
        if not s:
            print(f"  {label}  no snapshot")
            miss_no_snap += 1
            continue
        ts = s["timestamp"]
        wb_url = f"https://web.archive.org/web/{ts}/{s['original']}"
        print(f"  {label}  fetching {ts}", end=" ", flush=True)
        html = http_get(wb_url, timeout=60, retries=2)
        if not html:
            print("FAIL")
            miss_no_extract += 1
            time.sleep(delay)
            continue
        found = extract(_strip_html(html))
        if not found:
            print("no-extract (likely JS-rendered shell)")
            miss_no_extract += 1
            time.sleep(delay)
            continue
        date_iso = f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]}"
        t15 = found["term_15"] if found["term_15"] is not None else "-"
        t30 = found["term_30"] if found["term_30"] is not None else "-"
        print(f"15={t15} 30={t30}  date={date_iso}")
        rows.append({
            "date_iso": date_iso,
            "term_15": found["term_15"],
            "term_30": found["term_30"],
            "term_15_apr": found["term_15_apr"],
            "term_30_apr": found["term_30_apr"],
            "wayback_timestamp": ts,
            "fetched_at_utc": fetched_at,
            "source": "rocket_wayback",
        })
        time.sleep(delay)

    added, replaced = write_jsonl_merge(rocket_jsonl(), rows)
    print(
        f"\nRocket: wrote {len(rows)} usable rows  "
        f"(added={added} replaced={replaced} "
        f"no-snapshot={miss_no_snap} no-extract={miss_no_extract})"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, default=2020)
    parser.add_argument("--from-month", type=int, default=1)
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args()
    return backfill(args.from_year, args.from_month, args.delay)


if __name__ == "__main__":
    sys.exit(main())
