"""Headless-Chromium fetch of today's Bankrate NC mortgage rates.

The Bankrate NC page hydrates rate values via client-side JavaScript; a static
HTTP fetch sees only 0.00% placeholders. This script uses Playwright to launch
Chromium, wait for the rate table to populate, and extract both the intro
sentence values and the rate-table values for 15-yr and 30-yr fixed.

Appends one line per day to data/daily/bankrate_nc.jsonl. Re-runs on the same
day overwrite that day's row (idempotent).

Run: `python scripts/fetch_bankrate_nc_browser.py`
"""
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import BANKRATE_JSONL  # noqa: E402

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print(
        "ERROR: playwright not installed. Run: pip install -r requirements.txt && "
        "playwright install chromium",
        file=sys.stderr,
    )
    sys.exit(2)

URL = "https://www.bankrate.com/mortgages/mortgage-rates/north-carolina/"
JSONL_PATH = BANKRATE_JSONL

DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in North Carolina"
)


def table_pattern(term: int) -> re.Pattern[str]:
    # Updated table layout uses <div> wrapper instead of <th>:
    # <a ... href=".../{term}-year-mortgage-rates/">...</a></div></td><td ...>X.YZ%</td>
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</div>\s*</td>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )


def intro_pattern(term: int) -> re.Pattern[str]:
    return re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def extract_values(html: str) -> dict:
    out: dict = {}
    out["as_of"] = (m.group(1) if (m := DATE_INTRO_PAT.search(html)) else None)
    for term in (15, 30):
        tm = table_pattern(term).search(html)
        im = intro_pattern(term).search(html)
        out[f"table_{term}"] = float(tm.group(1)) if tm else None
        out[f"intro_{term}"] = float(im.group(1)) if im else None
    return out


def fetch_html() -> str:
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
            page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
            # Poll for hydration: the rate <td> next to "15-Year Fixed Rate" should stop being 0.00%.
            try:
                page.wait_for_function(
                    "() => Array.from(document.querySelectorAll('td')).some(td => /\\d\\.\\d{2,3}%/.test(td.textContent) && !td.textContent.trim().startsWith('0.00'))",
                    timeout=20_000,
                )
            except PlaywrightTimeout:
                print("WARNING: rate hydration did not complete; saving what we have.", file=sys.stderr)
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
    # Drop any prior row with the same date_iso, then append the new one.
    existing = [r for r in existing if r.get("date_iso") != new_row["date_iso"]]
    existing.append(new_row)
    existing.sort(key=lambda r: r.get("date_iso", ""))
    with open(path, "w", encoding="utf-8") as f:
        for r in existing:
            f.write(json.dumps(r) + "\n")


def main() -> int:
    print("Launching headless Chromium...")
    html = fetch_html()
    values = extract_values(html)

    table_15 = values["table_15"]
    table_30 = values["table_30"]
    intro_15 = values["intro_15"]
    intro_30 = values["intro_30"]
    print(
        f"  table 15={table_15}  table 30={table_30}  "
        f"intro 15={intro_15}  intro 30={intro_30}  as_of={values['as_of']}"
    )

    # Drop placeholder zeros — they mean hydration didn't complete.
    def real(v):
        return v if (isinstance(v, float) and v > 0.5) else None

    row = {
        "date_iso": dt.date.today().isoformat(),
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "as_of": values["as_of"],
        "table_15": real(table_15),
        "intro_15": real(intro_15),
        "table_30": real(table_30),
        "intro_30": real(intro_30),
        "source": "bankrate_nc_browser",
    }
    if not any(row[k] is not None for k in ("table_15", "table_30", "intro_15", "intro_30")):
        print("ERROR: no real values extracted; will not append a useless row.", file=sys.stderr)
        return 3

    write_jsonl_idempotent(JSONL_PATH, row)
    print(f"Wrote row for {row['date_iso']} -> {JSONL_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
