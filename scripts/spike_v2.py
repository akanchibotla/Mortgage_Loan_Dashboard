"""v2 spike: probe 3 representative states (CA / FL / WY) to validate that the
NC pipeline generalizes. Three checks per state:

  1. Bankrate live: headless-Chromium fetch of the state page, extract today's
     table values for 15-yr and 30-yr.
  2. Wayback coverage: CDX query for Bankrate state-page snapshots in our
     window (2024-06 .. today), count distinct months covered.
  3. HMDA: one-shot per-state filtered CSV download from FFIEC for CA only
     (representative; we don't need to download all three to confirm schema).

Run: python scripts/spike_v2.py
Output: scripts/spike_v2_report.json + console summary.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import REPO_ROOT  # noqa: E402

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: install playwright + chromium first", file=sys.stderr)
    sys.exit(2)

STATES = [
    {"fips": "06", "postal": "CA", "slug": "california", "name": "California"},
    {"fips": "12", "postal": "FL", "slug": "florida", "name": "Florida"},
    {"fips": "56", "postal": "WY", "slug": "wyoming", "name": "Wyoming"},
]
REPORT_PATH = os.path.join(REPO_ROOT, "scripts", "spike_v2_report.json")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def bankrate_url(slug: str) -> str:
    return f"https://www.bankrate.com/mortgages/mortgage-rates/{slug}/"


def table_pat(term: int) -> re.Pattern[str]:
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</div>\s*</td>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )


def intro_pat(term: int) -> re.Pattern[str]:
    return re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def fetch_bankrate_live(slug: str) -> dict:
    out: dict = {"slug": slug, "url": bankrate_url(slug)}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(user_agent=HEADERS["User-Agent"], locale="en-US")
            page = context.new_page()
            page.goto(bankrate_url(slug), wait_until="domcontentloaded", timeout=45_000)
            try:
                page.wait_for_function(
                    "() => Array.from(document.querySelectorAll('td')).some(td => /\\d\\.\\d{2,3}%/.test(td.textContent) && !td.textContent.trim().startsWith('0.00'))",
                    timeout=20_000,
                )
                out["hydrated"] = True
            except PlaywrightTimeout:
                out["hydrated"] = False
            html = page.content()
            browser.close()
    except Exception as e:
        out["error"] = str(e)
        return out
    for term in (15, 30):
        tm = table_pat(term).search(html)
        im = intro_pat(term).search(html)
        out[f"table_{term}"] = float(tm.group(1)) if tm else None
        out[f"intro_{term}"] = float(im.group(1)) if im else None
    return out


def cdx_query(slug: str) -> dict:
    target = f"bankrate.com/mortgages/mortgage-rates/{slug}/"
    from_ymd = "20240601"
    to_ymd = dt.date.today().strftime("%Y%m%d")
    url = (
        f"http://web.archive.org/cdx/search/cdx?url={target}"
        f"&from={from_ymd}&to={to_ymd}&filter=statuscode:200&output=json"
        "&collapse=timestamp:8"
    )
    out: dict = {"slug": slug, "cdx_url": url}
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8"))
            if not data:
                out["snapshots"] = 0
                out["distinct_months"] = 0
                return out
            _header, *rows = data
            timestamps = [r[1] for r in rows] if rows and len(rows[0]) > 1 else []
            months: set[str] = set()
            for ts in timestamps:
                if len(ts) >= 6:
                    months.add(ts[0:6])
            out["snapshots"] = len(timestamps)
            out["distinct_months"] = len(months)
            out["sample_months"] = sorted(list(months))[:6]
            return out
        except Exception as e:
            wait = 4 * (attempt + 1)
            out["last_error"] = str(e)
            time.sleep(wait)
    return out


def hmda_state_probe(postal: str) -> dict:
    """Download a small CSV slice for one state to confirm schema parity with NC."""
    url = (
        "https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?"
        f"states={postal}&years=2024&actions_taken=1&loan_purposes=1&loan_terms=180"
    )
    out: dict = {"postal": postal, "url": url}
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=180) as r:
            content = r.read()
        text = content.decode("utf-8", errors="ignore")
    except Exception as e:
        out["error"] = str(e)
        return out
    lines = text.splitlines()
    out["bytes"] = len(content)
    out["rows"] = max(0, len(lines) - 1)
    if not lines:
        return out
    header = lines[0].split(",")
    out["n_columns"] = len(header)
    # Confirm key columns are present and match NC schema.
    needed = {"state_code", "county_code", "interest_rate", "loan_term", "loan_amount", "loan_purpose", "action_taken"}
    out["has_needed_columns"] = needed.issubset(set(header))
    out["sample_first_row"] = (lines[1].split(",")[:6] if len(lines) > 1 else [])
    return out


def main() -> int:
    report: dict = {"generated_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds")}

    print("=== A. Bankrate live (headless Chromium) ===")
    bankrate_results = []
    for s in STATES:
        print(f"  {s['slug']}...", end=" ", flush=True)
        r = fetch_bankrate_live(s["slug"])
        bankrate_results.append(r)
        if r.get("error"):
            print(f"ERROR: {r['error'][:80]}")
        else:
            print(
                f"hydrated={r.get('hydrated')} "
                f"table_15={r.get('table_15')} table_30={r.get('table_30')} "
                f"intro_15={r.get('intro_15')} intro_30={r.get('intro_30')}"
            )
        time.sleep(3)
    report["bankrate_live"] = bankrate_results

    print("\n=== B. Wayback CDX coverage ===")
    cdx_results = []
    for s in STATES:
        print(f"  {s['slug']}...", end=" ", flush=True)
        r = cdx_query(s["slug"])
        cdx_results.append(r)
        if "snapshots" in r:
            print(f"snapshots={r['snapshots']} distinct_months={r['distinct_months']}")
        else:
            print(f"FAIL: {r.get('last_error', 'unknown')[:80]}")
        time.sleep(2)
    report["wayback_cdx"] = cdx_results

    print("\n=== C. HMDA state probe (CA only) ===")
    hmda = hmda_state_probe("CA")
    if hmda.get("error"):
        print(f"  CA: ERROR {hmda['error'][:80]}")
    else:
        print(
            f"  CA: {hmda.get('rows')} rows  cols={hmda.get('n_columns')}  "
            f"has_needed={hmda.get('has_needed_columns')}  bytes={hmda.get('bytes')}"
        )
    report["hmda_probe"] = hmda

    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport -> {REPORT_PATH}")

    # Decision summary.
    print("\n=== Decision summary ===")
    live_ok = sum(1 for r in bankrate_results if r.get("table_15") or r.get("intro_15"))
    cdx_ok = sum(1 for r in cdx_results if r.get("distinct_months", 0) >= 6)
    cdx_total_months = [r.get("distinct_months", 0) for r in cdx_results]
    print(f"  Bankrate live: {live_ok}/{len(STATES)} states returned real values")
    print(f"  Wayback: {cdx_ok}/{len(STATES)} states have >=6 distinct months covered ({cdx_total_months})")
    print(f"  HMDA shape: {'OK' if hmda.get('has_needed_columns') else 'MISMATCH'}")
    if live_ok == len(STATES) and cdx_ok >= 2 and hmda.get("has_needed_columns"):
        print("  GREEN: proceed with v2 generalization at full 50-state scale")
        return 0
    print("  YELLOW/RED: re-evaluate scope before scaling to 50")
    return 1


if __name__ == "__main__":
    sys.exit(main())
