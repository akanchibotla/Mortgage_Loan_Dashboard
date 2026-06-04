"""Fetch today's national Rocket Mortgage rates (15-yr + 30-yr fixed) and
append to a daily JSONL accumulator.

Rocket Mortgage publishes a single national rate-quote page at
https://www.rocketmortgage.com/mortgage-rates — there is no per-state page
(every /mortgage-rates/<slug> URL returns 404). So this fetcher takes no
--state argument; it writes one row per day to data/daily/rocket.jsonl and
emits src/data/rocket_today.json as the "current value" snapshot.

Two-tier fetch strategy:
  Tier 1 — static urllib GET with retry-with-backoff (fast path, ~1s).
           Works when Rocket's CDN isn't in bot-challenge mode.
  Tier 2 — Playwright headless Chromium with stealth flags and a /homepage
           warmup hop to seed cookies before navigating to /mortgage-rates.
           Catches intermittent Akamai 403s that block urllib but let a
           browser through. (Persistent 403s still fail both — Rocket has
           tightened detection in 2026 Q2 to the point where neither tier
           is reliable from a residential or datacenter IP. Surfaced via
           the FAIL_LOG so the validator can flag the gap.)

robots.txt is permissive (only /reset-account is disallowed), so a polite
once-per-day fetch is well within crawl norms.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import fetch_html  # noqa: E402
from _paths import rocket_jsonl, rocket_today_view  # noqa: E402

URL = "https://www.rocketmortgage.com/mortgage-rates"
HOMEPAGE_URL = "https://www.rocketmortgage.com/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

GOTO_TIMEOUT_MS = 45_000
HYDRATION_TIMEOUT_MS = 25_000
WARMUP_SLEEP_S = 3


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


def fetch_browser() -> str | None:
    """Tier 2: Playwright with stealth + homepage warmup. Returns the
    /mortgage-rates page HTML or None if the browser path also bounces."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        print("  Tier 2: playwright not installed; skipping browser fallback", file=sys.stderr)
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                ],
            )
            try:
                context = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                    ),
                    locale="en-US",
                    viewport={"width": 1366, "height": 900},
                    timezone_id="America/New_York",
                    extra_http_headers={
                        "Accept-Language": "en-US,en;q=0.9",
                        "Upgrade-Insecure-Requests": "1",
                        "Sec-Fetch-Dest": "document",
                        "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-Site": "none",
                        "Sec-Fetch-User": "?1",
                    },
                )
                context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
                    "Object.defineProperty(navigator, 'languages', {get: () => ['en-US','en']});"
                    "Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});"
                    "window.chrome = window.chrome || {runtime: {}};"
                )
                page = context.new_page()
                # Hit the homepage first so the session has Akamai cookies
                # before the rate-card request. Without this warmup hop the
                # /mortgage-rates request lands cold and gets the challenge
                # page every time.
                try:
                    page.goto(HOMEPAGE_URL, wait_until="domcontentloaded", timeout=GOTO_TIMEOUT_MS)
                    time.sleep(WARMUP_SLEEP_S)
                except PlaywrightTimeout:
                    print("  Tier 2: homepage warmup timed out; continuing to rates page", file=sys.stderr)
                try:
                    page.goto(URL, wait_until="domcontentloaded", timeout=GOTO_TIMEOUT_MS)
                except PlaywrightTimeout:
                    print("  Tier 2: rates page goto timed out; reading partial DOM", file=sys.stderr)
                try:
                    page.wait_for_function(
                        "() => /\\d+\\.\\d{1,3}%/.test(document.body.innerText || '')",
                        timeout=HYDRATION_TIMEOUT_MS,
                    )
                except PlaywrightTimeout:
                    print("  Tier 2: rate hydration did not complete", file=sys.stderr)
                html = page.content()
                # The Akamai challenge page is small (~12KB) and titled
                # "Unable to Process Request". Bail explicitly so the caller
                # can record a real failure rather than a partial extract.
                if "Unable to Process Request" in html:
                    print("  Tier 2: Akamai block page returned", file=sys.stderr)
                    return None
                return html
            finally:
                browser.close()
    except Exception as e:  # broad: any Playwright launch / runtime failure
        print(f"  Tier 2 raised: {e}", file=sys.stderr)
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
    source_method = "static"
    html = fetch_html(URL, HEADERS, timeout=30)
    found: dict | None = None
    if html is not None:
        found = extract(_strip_html(html))

    if not found:
        # Tier 1 either errored (403) or returned a page where neither term
        # matched. Try the browser path.
        print("  Tier 1 (static) yielded no values; trying Tier 2 (browser)", file=sys.stderr)
        html2 = fetch_browser()
        if html2 is not None:
            found = extract(_strip_html(html2))
            if found:
                source_method = "browser"

    if not found:
        print("ERROR: all tiers failed for Rocket national page", file=sys.stderr)
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
        "source_method": source_method,
    }
    t15 = found["term_15"] if found["term_15"] is not None else "-"
    t30 = found["term_30"] if found["term_30"] is not None else "-"
    print(
        f"  15-yr: {t15}%  (APR {found['term_15_apr']}%) · "
        f"30-yr: {t30}%  (APR {found['term_30_apr']}%) · "
        f"date_iso: {date_iso} · method: {source_method}"
    )
    write_jsonl_idempotent(rocket_jsonl(), row)
    write_today_view(rocket_today_view(), row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
