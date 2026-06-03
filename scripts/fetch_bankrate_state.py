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
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import bankrate_jsonl  # noqa: E402
from states import by_slug  # noqa: E402

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: playwright not installed", file=sys.stderr)
    sys.exit(2)

GOTO_TIMEOUT_MS = 60_000  # bumped from 45s for slow runner network
HYDRATION_TIMEOUT_MS = 30_000  # bumped from 20s
RETRY_BACKOFFS_S = [4, 12]  # 3 attempts total: try, +4s, retry, +12s, retry


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


def _fetch_html_once(slug: str) -> str:
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
            try:
                page.goto(url_for(slug), wait_until="domcontentloaded", timeout=GOTO_TIMEOUT_MS)
            except PlaywrightTimeout:
                # Even on timeout we may already have the intro values in static HTML.
                print(f"WARNING: page.goto timed out for {slug}; using partial DOM", file=sys.stderr)
            try:
                page.wait_for_function(
                    "() => Array.from(document.querySelectorAll('td')).some(td => /\\d\\.\\d{2,3}%/.test(td.textContent) && !td.textContent.trim().startsWith('0.00'))",
                    timeout=HYDRATION_TIMEOUT_MS,
                )
            except PlaywrightTimeout:
                print(f"WARNING: rate hydration did not complete for {slug}", file=sys.stderr)
            return page.content()
        finally:
            browser.close()


def _html_has_real_values(html: str) -> bool:
    """An attempt is real only if at least one term yields a non-placeholder value
    from either the table or the intro band."""
    for term in (15, 30):
        for pat in (table_pattern(term), intro_pattern(term)):
            m = pat.search(html)
            if m and real(float(m.group(1))) is not None:
                return True
    return False


def fetch_html(slug: str) -> tuple[str, int]:
    """Try up to len(RETRY_BACKOFFS_S)+1 times. Returns (html, attempts_used).

    An attempt is "successful" only when the HTML contains at least one real
    rate value (table_* or intro_*). Un-hydrated pages still return long HTML
    so a size check alone never retries — see the bug where every failure
    showed attempts=1 despite a 3-attempt budget."""
    last_err: Exception | None = None
    best_html: str | None = None
    for attempt in range(len(RETRY_BACKOFFS_S) + 1):
        try:
            html = _fetch_html_once(slug)
            if html and len(html) > 1000:
                if _html_has_real_values(html):
                    return html, attempt + 1
                best_html = html
                print(
                    f"  attempt {attempt + 1}: HTML returned but no real rate values; will retry",
                    file=sys.stderr,
                )
            else:
                print(
                    f"  attempt {attempt + 1}: HTML too short ({len(html) if html else 0} chars)",
                    file=sys.stderr,
                )
        except Exception as e:  # broad: include browser launch + sync_playwright errors
            last_err = e
            print(f"  attempt {attempt + 1} raised: {e}", file=sys.stderr)
        if attempt < len(RETRY_BACKOFFS_S):
            delay = RETRY_BACKOFFS_S[attempt]
            print(f"  sleeping {delay}s before retry", file=sys.stderr)
            time.sleep(delay)
    # Exhausted retries. If we ever got a usable-length page, return it so the
    # caller can still record a partial row (as_of, etc.) instead of raising.
    if best_html is not None:
        return best_html, len(RETRY_BACKOFFS_S) + 1
    raise RuntimeError(
        f"Bankrate fetch_html failed for {slug} after {len(RETRY_BACKOFFS_S) + 1} attempts: {last_err}"
    )


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
    try:
        html, attempts = fetch_html(slug)
    except Exception as e:
        print(f"ERROR: Bankrate fetch_html for {slug} unrecoverable: {e}", file=sys.stderr)
        return 4
    as_of = DATE_INTRO_PAT.search(html)
    out = {
        "date_iso": dt.date.today().isoformat(),
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "as_of": as_of.group(1) if as_of else None,
        "state_slug": slug,
        "source": "bankrate_state_browser",
        "attempts": attempts,
    }
    for term in (15, 30):
        tm = table_pattern(term).search(html)
        im = intro_pattern(term).search(html)
        out[f"table_{term}"] = real(float(tm.group(1)) if tm else None)
        out[f"intro_{term}"] = real(float(im.group(1)) if im else None)
    print(
        f"  table_15={out['table_15']}  table_30={out['table_30']}  "
        f"intro_15={out['intro_15']}  intro_30={out['intro_30']}  as_of={out['as_of']}  "
        f"(attempts={attempts})"
    )
    if not any(out[k] is not None for k in ("table_15", "table_30", "intro_15", "intro_30")):
        print(f"ERROR: no real values extracted for {slug} after {attempts} attempt(s)", file=sys.stderr)
        return 3
    # Intro-only counts as success — reconcile prefers table_* but falls back to intro_*.
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
