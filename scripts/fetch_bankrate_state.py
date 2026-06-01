"""Headless-Chromium fetch of today's Bankrate state-level mortgage rates.

Generalized version of fetch_bankrate_nc_browser.py. Accepts --state SLUG
(default north-carolina) and writes to data/daily/bankrate_{slug}.jsonl.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import bankrate_jsonl  # noqa: E402
from states import by_slug  # noqa: E402

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: playwright not installed", file=sys.stderr)
    sys.exit(2)


def url_for(slug: str) -> str:
    return f"https://www.bankrate.com/mortgages/mortgage-rates/{slug}/"


DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in"
)


def table_pattern(term: int) -> re.Pattern[str]:
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</div>\s*</td>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )


def intro_pattern(term: int) -> re.Pattern[str]:
    return re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def fetch_html(slug: str) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
                ),
                locale="en-US",
            )
            page = context.new_page()
            page.goto(url_for(slug), wait_until="domcontentloaded", timeout=45_000)
            try:
                page.wait_for_function(
                    "() => Array.from(document.querySelectorAll('td')).some(td => /\\d\\.\\d{2,3}%/.test(td.textContent) && !td.textContent.trim().startsWith('0.00'))",
                    timeout=20_000,
                )
            except PlaywrightTimeout:
                print(f"WARNING: rate hydration did not complete for {slug}", file=sys.stderr)
            return page.content()
        finally:
            browser.close()


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
                    continue
    existing = [r for r in existing if r.get("date_iso") != new_row["date_iso"]]
    existing.append(new_row)
    existing.sort(key=lambda r: r.get("date_iso", ""))
    with open(path, "w", encoding="utf-8") as f:
        for r in existing:
            f.write(json.dumps(r) + "\n")


def real(v):
    return v if (isinstance(v, float) and v > 0.5) else None


def run_one(slug: str) -> int:
    state = by_slug(slug)
    print(f"Fetching Bankrate {state['name']} ({state['postal']}) ...")
    html = fetch_html(slug)
    as_of = DATE_INTRO_PAT.search(html)
    out = {
        "date_iso": dt.date.today().isoformat(),
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "as_of": as_of.group(1) if as_of else None,
        "state_slug": slug,
        "source": "bankrate_state_browser",
    }
    for term in (15, 30):
        tm = table_pattern(term).search(html)
        im = intro_pattern(term).search(html)
        out[f"table_{term}"] = real(float(tm.group(1)) if tm else None)
        out[f"intro_{term}"] = real(float(im.group(1)) if im else None)
    print(
        f"  table_15={out['table_15']}  table_30={out['table_30']}  "
        f"intro_15={out['intro_15']}  intro_30={out['intro_30']}  as_of={out['as_of']}"
    )
    if not any(out[k] is not None for k in ("table_15", "table_30", "intro_15", "intro_30")):
        print("ERROR: no real values extracted", file=sys.stderr)
        return 3
    path = bankrate_jsonl(slug)
    write_jsonl_idempotent(path, out)
    print(f"Wrote {out['date_iso']} -> {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="north-carolina", help="state slug (e.g. california)")
    parser.add_argument("--all", action="store_true", help="fetch all 50 states + DC")
    args = parser.parse_args()
    if args.all:
        from states import STATES
        rc = 0
        for s in STATES:
            r = run_one(s["slug"])
            if r != 0:
                rc = r
        return rc
    return run_one(args.state)


if __name__ == "__main__":
    sys.exit(main())
