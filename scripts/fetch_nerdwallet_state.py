"""Fetch today's NerdWallet state-level rates (15-yr + 30-yr) and append to JSONL.

NerdWallet's per-state URL is `/mortgages/mortgage-rates/<slug>`. The page is
server-rendered (no JS hydration required) and uses the same lowercase-hyphenated
state slugs as MND / Bankrate. Each state page surfaces two relevant signals:

  1. A headline line: "30-Year Fixed APR X.XX%" and "15-Year Fixed APR X.XX%"
     with a 1-week delta. APR includes fees, so it runs ~5–15 bps above the
     note rate.

  2. A product table with rows like "30-year Fixed  6.29%  6.30%" where the
     first percentage is the Interest rate (note rate) and the second is APR.
     This is the apples-to-apples comparable to Bankrate / MND, both of which
     publish a purchase Interest rate, not APR.

We capture both: the Interest rate goes into `term_15` / `term_30` (charted
alongside Bankrate / MND); APR is preserved in `term_15_apr` / `term_30_apr`
for future use. Plus the page's own as-of timestamp.

robots.txt: `/mortgages/mortgage-rates/*` is not disallowed (only admin/api/
embed/prequal paths are). One fetch per state per day is well within polite
crawl norms.
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
from _paths import nerdwallet_jsonl, nerdwallet_today_view  # noqa: E402
from states import by_slug  # noqa: E402

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Headline APR line — anchored on the exact "1w" delta marker that follows
# each rate, so we don't false-match a 30-year-fixed APR from a comparison row.
HEADLINE_30_PAT = re.compile(r"30-Year Fixed APR\s+(\d+\.\d{1,3})%\s+-?\d+\.\d+%\s+1w", re.I)
HEADLINE_15_PAT = re.compile(r"15-Year Fixed APR\s+(\d+\.\d{1,3})%\s+-?\d+\.\d+%\s+1w", re.I)

# Product table row — "30-year Fixed   6.29%   6.30%" (interest rate then APR).
# Negative lookahead skips FHA / VA / Jumbo variants so we only match the
# conventional headline product.
PRODUCT_30_PAT = re.compile(
    r"30-year Fixed\s+(?!FHA|VA|Jumbo)(\d+\.\d{1,3})%\s+(\d+\.\d{1,3})%",
    re.I,
)
PRODUCT_15_PAT = re.compile(
    r"15-year Fixed\s+(?!FHA|VA|Jumbo)(\d+\.\d{1,3})%\s+(\d+\.\d{1,3})%",
    re.I,
)

# As-of timestamp printed on the page, e.g.:
#   "Rates are current as of June 3, 2026 2:10 PM EDT"
AS_OF_PAT = re.compile(
    r"current as of\s+([A-Z][a-z]+ \d{1,2},\s+20\d{2}\s+\d{1,2}:\d{2}\s*[AP]M\s+[A-Z]{2,4})",
    re.I,
)


def url_for(slug: str) -> str:
    return f"https://www.nerdwallet.com/mortgages/mortgage-rates/{slug}"


def _strip_html(html: str) -> str:
    """Strip script/style and tags so regex can run on flat text."""
    s = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


def _parse_as_of(raw: str | None) -> str | None:
    """NerdWallet stamp → ISO date (drop time-of-day; daily granularity is enough)."""
    if not raw:
        return None
    m = re.match(r"([A-Z][a-z]+)\s+(\d{1,2}),\s+(20\d{2})", raw)
    if not m:
        return None
    try:
        return dt.datetime.strptime(
            f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y"
        ).date().isoformat()
    except ValueError:
        return None


def extract(text: str) -> dict | None:
    """Pull both Interest rate (canonical) and APR (secondary) from one page."""
    # Try product-table interest+APR first; fall back to headline-only APR.
    p30 = PRODUCT_30_PAT.search(text)
    p15 = PRODUCT_15_PAT.search(text)
    h30 = HEADLINE_30_PAT.search(text)
    h15 = HEADLINE_15_PAT.search(text)

    term_30 = float(p30.group(1)) if p30 else (float(h30.group(1)) if h30 else None)
    term_30_apr = float(p30.group(2)) if p30 else (float(h30.group(1)) if h30 else None)
    term_15 = float(p15.group(1)) if p15 else (float(h15.group(1)) if h15 else None)
    term_15_apr = float(p15.group(2)) if p15 else (float(h15.group(1)) if h15 else None)

    if term_15 is None and term_30 is None:
        return None

    as_of_m = AS_OF_PAT.search(text)
    as_of_raw = as_of_m.group(1).strip() if as_of_m else None
    return {
        "term_15": term_15,
        "term_30": term_30,
        "term_15_apr": term_15_apr,
        "term_30_apr": term_30_apr,
        "as_of_raw": as_of_raw,
        "extracted_from": "product_table" if (p30 or p15) else "headline_only",
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
        "as_of_raw": row["as_of_raw"],
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


def run_one(slug: str) -> int:
    state = by_slug(slug)
    print(f"Fetching NerdWallet {state['name']} ...")
    req = urllib.request.Request(url_for(slug), headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    text = _strip_html(html)
    found = extract(text)
    if not found:
        print("ERROR: rate values not found", file=sys.stderr)
        return 3
    date_iso = _parse_as_of(found["as_of_raw"]) or dt.date.today().isoformat()
    row = {
        "date_iso": date_iso,
        "term_15": found["term_15"],
        "term_30": found["term_30"],
        "term_15_apr": found["term_15_apr"],
        "term_30_apr": found["term_30_apr"],
        "as_of_raw": found["as_of_raw"],
        "extracted_from": found["extracted_from"],
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "state_slug": slug,
        "source": "nerdwallet_live",
    }
    print(
        f"  15-yr: {found['term_15']}%  (APR {found['term_15_apr']}%) · "
        f"30-yr: {found['term_30']}%  (APR {found['term_30_apr']}%) · "
        f"as_of: {found['as_of_raw']} · src: {found['extracted_from']}"
    )
    write_jsonl_idempotent(nerdwallet_jsonl(slug), row)
    write_today_view(nerdwallet_today_view(slug), row)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="north-carolina")
    parser.add_argument("--all", action="store_true")
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Seconds between requests when --all is used (default 2.0)",
    )
    args = parser.parse_args()
    if args.all:
        from states import STATES
        rc = 0
        for s in STATES:
            r = run_one(s["slug"])
            if r != 0:
                rc = r
            time.sleep(args.delay)
        return rc
    return run_one(args.state)


if __name__ == "__main__":
    sys.exit(main())
