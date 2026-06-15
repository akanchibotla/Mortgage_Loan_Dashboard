"""Headless-Chromium fetch of today's Bankrate state-level mortgage rates.

Three-tier fetch strategy (each tier only runs when the previous yielded no
real rate values):
  Tier 1 — Playwright headless Chromium with 3 retries (hydration-tolerant).
  Tier 2 — Static HTML via urllib (no JS execution). Catches cases where the
           server already rendered intro values but the JS rate table widget
           never hydrated in Chromium.
  Tier 3 — Wayback Machine: most-recent snapshot of the page in the last 7
           days. Catches persistently-cloaked states that some archiver still
           reached.

Each written row carries a `source_method` of "browser", "static_html",
"wayback", or "wayback_<YYYYMMDD>" so coverage can be audited.
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
from _paths import bankrate_jsonl  # noqa: E402
from states import by_slug  # noqa: E402

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: playwright not installed", file=sys.stderr)
    sys.exit(2)

# Bankrate serves a 404 for these state slugs (no per-state page exists).
# We exit early with success so the daily refresh validator can skip the
# bk_missing/bk_stale checks for them — mirrors NerdWallet's KNOWN_NO_COVERAGE.
KNOWN_NO_COVERAGE: set[str] = {"district-of-columbia"}

GOTO_TIMEOUT_MS = 60_000  # bumped from 45s for slow runner network
HYDRATION_TIMEOUT_MS = 45_000  # bumped from 30s; gives slow states more room
RETRY_BACKOFFS_S = [4, 12]  # 3 attempts total: try, +4s, retry, +12s, retry
STATIC_TIMEOUT_S = 30
WAYBACK_TIMEOUT_S = 60
WAYBACK_LOOKBACK_DAYS = 7

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
)
STATIC_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def url_for(slug: str) -> str:
    return f"https://www.bankrate.com/mortgages/mortgage-rates/{slug}/"


DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in"
)


def table_pattern(term: int) -> re.Pattern[str]:
    """Legacy Bankrate format (pre-2026 redesign): kept as fallback in case any
    server still serves the old DOM. The new layout matched by
    `table_pattern_v2` is the current one as of June 2026."""
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</div>\s*</td>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )


def table_pattern_v2(term: int) -> re.Pattern[str]:
    """Current Bankrate format (June 2026 redesign): the rate-label cell uses
    <strong> instead of a <div>, and the adjacent value cell carries the rate
    as a `data-value="X.XX"` attribute on the <td>. Extracting from the
    attribute avoids unicode/whitespace fragility around the inner text."""
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>(?:<strong>)?[^<]*(?:</strong>)?</a>\s*</td>\s*<td[^>]*data-value=\"(\d\.\d{{1,3}})\"",
        re.IGNORECASE | re.DOTALL,
    )


def intro_pattern(term: int) -> re.Pattern[str]:
    return re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def _fetch_html_once(slug: str) -> str:
    with sync_playwright() as p:
        # Stealth flags: --disable-blink-features=AutomationControlled is the
        # single most-impactful evasion — it stops the browser from declaring
        # itself a webdriver in the navigator.webdriver getter, which is the
        # check most of Bankrate's anti-bot vendors look at first. The
        # init script below removes the residual signal that some vendors
        # still poke at by reflecting on the descriptor.
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
    from any of the table (v2 or v1) or the intro band."""
    for term in (15, 30):
        for pat in (table_pattern_v2(term), table_pattern(term), intro_pattern(term)):
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


def extract_values(html: str) -> dict:
    """Pull as_of + table/intro values for both terms out of any Bankrate HTML
    (live browser, static, or Wayback). Returns a dict with keys
    `as_of`, `table_15`, `table_30`, `intro_15`, `intro_30`."""
    as_of = DATE_INTRO_PAT.search(html)
    out: dict = {"as_of": as_of.group(1) if as_of else None}
    for term in (15, 30):
        # Try the current (v2) format first; fall back to the legacy DOM if a
        # cached or partially-rendered page is still serving the old structure.
        tm2 = table_pattern_v2(term).search(html)
        tm = tm2 or table_pattern(term).search(html)
        im = intro_pattern(term).search(html)
        out[f"table_{term}"] = real(float(tm.group(1)) if tm else None)
        out[f"intro_{term}"] = real(float(im.group(1)) if im else None)
    return out


def _values_present(vals: dict) -> bool:
    return any(vals.get(k) is not None for k in ("table_15", "table_30", "intro_15", "intro_30"))


def fetch_static(slug: str) -> str | None:
    """Tier 2: plain urllib fetch of the live Bankrate page (no JS). The intro
    band values are often server-side rendered even when JS hydration breaks."""
    try:
        req = urllib.request.Request(url_for(slug), headers=STATIC_HEADERS)
        with urllib.request.urlopen(req, timeout=STATIC_TIMEOUT_S) as r:
            return r.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"  Tier 2 (static HTML) raised: {e}", file=sys.stderr)
        return None


def fetch_wayback(slug: str) -> tuple[str, str] | None:
    """Tier 3: most-recent Wayback snapshot of the page in the last
    WAYBACK_LOOKBACK_DAYS. Returns (html, snapshot_yyyymmdd) or None."""
    target = f"bankrate.com/mortgages/mortgage-rates/{slug}/"
    today = dt.date.today()
    from_ymd = (today - dt.timedelta(days=WAYBACK_LOOKBACK_DAYS)).strftime("%Y%m%d")
    to_ymd = today.strftime("%Y%m%d")
    cdx = (
        f"http://web.archive.org/cdx/search/cdx?url={target}"
        f"&from={from_ymd}&to={to_ymd}&filter=statuscode:200&output=json&limit=10"
    )
    try:
        req = urllib.request.Request(cdx, headers=STATIC_HEADERS)
        with urllib.request.urlopen(req, timeout=STATIC_TIMEOUT_S) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace") or "[]")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  Tier 3 (Wayback CDX) raised: {e}", file=sys.stderr)
        return None
    if not data or len(data) < 2:
        print(f"  Tier 3: no Wayback snapshots in the last {WAYBACK_LOOKBACK_DAYS}d for {slug}", file=sys.stderr)
        return None
    # First row is the header; rest are snapshots ordered oldest-first. Take last.
    last = data[-1]
    ts = last[1]
    original = last[2]
    # id_ flag returns the original page content without the Wayback toolbar.
    snap_url = f"https://web.archive.org/web/{ts}id_/{original}"
    try:
        req = urllib.request.Request(snap_url, headers=STATIC_HEADERS)
        with urllib.request.urlopen(req, timeout=WAYBACK_TIMEOUT_S) as r:
            return r.read().decode("utf-8", errors="replace"), ts[:8]
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"  Tier 3 (Wayback snapshot {ts}) raised: {e}", file=sys.stderr)
        return None


def run_one(slug: str) -> int:
    state = by_slug(slug)
    if slug in KNOWN_NO_COVERAGE:
        print(
            f"Skipping Bankrate {state['name']} ({state['postal']}): no per-state page exists "
            f"(KNOWN_NO_COVERAGE)."
        )
        return 0
    print(f"Fetching Bankrate {state['name']} ({state['postal']}) ...")

    # Tier 1: Playwright headless browser
    html: str | None = None
    attempts = 0
    source_method = "browser"
    snapshot_date: str | None = None
    try:
        html, attempts = fetch_html(slug)
    except Exception as e:
        print(f"  Tier 1 (browser) unrecoverable: {e}", file=sys.stderr)
        html = None

    vals: dict = extract_values(html) if html else {}

    # Tier 2: static HTML
    if not _values_present(vals):
        print(f"  Tier 1 yielded no real values; trying Tier 2 (static HTML)", file=sys.stderr)
        html2 = fetch_static(slug)
        if html2:
            vals2 = extract_values(html2)
            if _values_present(vals2):
                vals = vals2
                source_method = "static_html"
                print(f"  Tier 2 (static HTML) succeeded for {slug}")

    # Tier 3: Wayback Machine
    if not _values_present(vals):
        print(f"  Tier 2 yielded no real values; trying Tier 3 (Wayback)", file=sys.stderr)
        wb = fetch_wayback(slug)
        if wb is not None:
            html3, snapshot_date = wb
            vals3 = extract_values(html3)
            if _values_present(vals3):
                vals = vals3
                source_method = "wayback"
                print(f"  Tier 3 (Wayback {snapshot_date}) succeeded for {slug}")

    out = {
        "date_iso": dt.date.today().isoformat(),
        "fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "as_of": vals.get("as_of"),
        "state_slug": slug,
        "source": "bankrate_state_browser",
        "source_method": source_method,
        "attempts": attempts,
        "table_15": vals.get("table_15"),
        "table_30": vals.get("table_30"),
        "intro_15": vals.get("intro_15"),
        "intro_30": vals.get("intro_30"),
    }
    if snapshot_date:
        out["wayback_snapshot"] = snapshot_date
    print(
        f"  table_15={out['table_15']}  table_30={out['table_30']}  "
        f"intro_15={out['intro_15']}  intro_30={out['intro_30']}  as_of={out['as_of']}  "
        f"(method={source_method}, attempts={attempts})"
    )
    if not _values_present(out):
        print(f"ERROR: all tiers failed for {slug} after attempts={attempts}", file=sys.stderr)
        return 3
    # Intro-only counts as success — reconcile prefers table_* but falls back to intro_*.
    path = bankrate_jsonl(slug)
    write_jsonl_idempotent(path, out)
    print(f"Wrote {out['date_iso']} -> {path}  (method={source_method})")
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
