"""Fetch today's national Rocket Mortgage rates (15-yr + 30-yr fixed) and
append to a daily JSONL accumulator.

Rocket Mortgage publishes a single national rate-quote page at
https://www.rocketmortgage.com/mortgage-rates — there is no per-state page
(every /mortgage-rates/<slug> URL returns 404). So this fetcher takes no
--state argument; it writes one row per day to data/daily/rocket.jsonl and
emits src/data/rocket_today.json as the "current value" snapshot.

The page is server-rendered HTML (no JS hydration required) and the rates
appear in an anchored format we can pin with a regex:

  "15-year fixed Rate X.XX% APR ... X.XXX% Monthly payment ..."
  "30-year fixed Rate X.XXX% APR ... X.XXX% Monthly payment ..."

robots.txt is permissive (only /reset-account is disallowed), so a polite
once-per-day fetch is well within crawl norms.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import rocket_jsonl, rocket_today_view  # noqa: E402

URL = "https://www.rocketmortgage.com/mortgage-rates"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Rate-row pattern. The headline rate-card block, after HTML is stripped, reads:
#   "15-year fixed Rate 5.99% APR <tooltip noise> 6.417% Monthly payment ..."
# We anchor on the exact "{N}-year fixed Rate" -> "% APR ... %" sequence so we
# don't accidentally match the same numbers reused in marketing copy or the
# FHA / VA / ARM / refinance variants further down the page.
def _row_pattern(term: int) -> re.Pattern[str]:
    return re.compile(
        rf"{term}-year fixed\s+Rate\s+(\d+\.\d{{1,3}})%\s+APR.*?(\d+\.\d{{1,3}})%",
        re.I | re.S,
    )


def _strip_html(html: str) -> str:
    s = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


def extract(text: str) -> dict | None:
    m15 = _row_pattern(15).search(text)
    m30 = _row_pattern(30).search(text)
    if not m15 and not m30:
        return None
    return {
        "term_15": float(m15.group(1)) if m15 else None,
        "term_30": float(m30.group(1)) if m30 else None,
        "term_15_apr": float(m15.group(2)) if m15 else None,
        "term_30_apr": float(m30.group(2)) if m30 else None,
    }


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
    with open(path, "w", encoding="utf-8") as f:
        for r in sorted(by_date.values(), key=lambda r: r.get("date_iso", "")):
            f.write(json.dumps(r) + "\n")


def write_today_view(path: str, row: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = {
        "fetched_at_utc": row["fetched_at_utc"],
        "as_of_iso": row["date_iso"],
        "term_15": (
            {"rate_pct": row["term_15"], "apr_pct": row["term_15_apr"], "as_of_iso": row["date_iso"]}
            if row["term_15"] is not None else None
        ),
        "term_30": (
            {"rate_pct": row["term_30"], "apr_pct": row["term_30_apr"], "as_of_iso": row["date_iso"]}
            if row["term_30"] is not None else None
        ),
    }
    with open(path, "w") as f:
        json.dump(out, f, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--date-iso",
        default=None,
        help="override the date_iso recorded on the row (default: today UTC)",
    )
    args = parser.parse_args()

    print(f"Fetching Rocket Mortgage national rates from {URL} ...")
    req = urllib.request.Request(URL, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    text = _strip_html(html)
    found = extract(text)
    if not found:
        print("ERROR: rate values not found in page", file=sys.stderr)
        return 3
    date_iso = args.date_iso or dt.date.today().isoformat()
    row = {
        "date_iso": date_iso,
        "term_15": found["term_15"],
        "term_30": found["term_30"],
        "term_15_apr": found["term_15_apr"],
        "term_30_apr": found["term_30_apr"],
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "source": "rocket_live",
    }
    t15 = found["term_15"] if found["term_15"] is not None else "-"
    t30 = found["term_30"] if found["term_30"] is not None else "-"
    print(
        f"  15-yr: {t15}%  (APR {found['term_15_apr']}%) · "
        f"30-yr: {t30}%  (APR {found['term_30_apr']}%) · "
        f"date_iso: {date_iso}"
    )
    write_jsonl_idempotent(rocket_jsonl(), row)
    write_today_view(rocket_today_view(), row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
