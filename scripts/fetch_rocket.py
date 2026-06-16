"""Fetch today's national Rocket Mortgage rates (15-yr + 30-yr fixed) and
append to a daily JSONL accumulator.

Rocket Mortgage publishes a single national rate-quote page at
https://www.rocketmortgage.com/mortgage-rates. The same rate values are
mirrored on three other URL patterns we discovered in their sitemap.xml,
which gives us a four-fold fetch fallback before we have to escalate to a
headless browser:

  Tier 1a — /mortgage-rates                       (both terms, ~1.7 MB)
  Tier 1b — /mortgage-rates/15-year-mortgage-rates (15yr only, ~1.6 MB)
  Tier 1c — /mortgage-rates/30-year-mortgage-rates (30yr only, ~1.6 MB)
  Tier 1d — /mortgage-rates/<state>-mortgage-rates (SEO landing, ~1.7 MB)
            All states show the *national* rate value, so any state works.
            Useful because these SEO pages get less bot traffic and Akamai
            often lets them through when the main page is challenge-walled.

  Tier 2  — Playwright headless Chromium with stealth flags and a homepage
            warmup hop. Last-resort path for when every urllib URL bounces.
            Frequently Akamai-blocked from datacenter IPs (GH Actions) and
            from "hot" residential IPs, but occasionally squeaks through.

  Tier 3  — Wayback Machine: most-recent CDX snapshot of any rocketmortgage
            /mortgage-rates* URL in the last 30 days. Since the chart only
            consumes a monthly mean (`aggregate_rocket.py`), even one
            Wayback hit per month keeps the bar non-null. The Wayback row
            is recorded under the *snapshot's* date_iso (not today's), so
            it lands in the correct calendar month for the aggregator.

The fetcher tries Tier 1a first. If it 403s or returns a page without rate
values, it falls through to 1b and 1c in parallel-conceptual sequence
(merging single-term results into a combined row), then 1d, then Tier 2,
then Tier 3. Each row records which tier produced it via `source_method`.

Per-state pages: every /mortgage-rates/<slug>-mortgage-rates URL on Rocket
shows the same national rate value, not a real state average. So this
fetcher remains national-only — there is no per-state row to write.

robots.txt is permissive (only /reset-account is disallowed), so a polite
sequential fallback (worst case ~4 requests) is well within crawl norms.
"""
import argparse
import datetime as dt
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import fetch_html  # noqa: E402
from _paths import rocket_jsonl, rocket_today_view  # noqa: E402

BASE = "https://www.rocketmortgage.com"
URL_PRIMARY = f"{BASE}/mortgage-rates"
URL_15_ONLY = f"{BASE}/mortgage-rates/15-year-mortgage-rates"
URL_30_ONLY = f"{BASE}/mortgage-rates/30-year-mortgage-rates"
# We rotate through several SEO landing pages because Akamai sometimes
# rate-limits a single URL while letting siblings through. All three return
# the same national rate values — confirmed by side-by-side probe.
URL_STATE_SEO_CANDIDATES = [
    f"{BASE}/mortgage-rates/north-carolina-mortgage-rates",
    f"{BASE}/mortgage-rates/california-mortgage-rates",
    f"{BASE}/mortgage-rates/illinois-mortgage-rates",
]
HOMEPAGE_URL = f"{BASE}/"

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

# Wayback: snapshots of rocketmortgage.com/mortgage-rates are sparse
# (~2/month observed). Look back 30 days so a fallback during a multi-week
# block drought still has something to grab.
WAYBACK_LOOKBACK_DAYS = 30
WAYBACK_CDX_TIMEOUT_S = 30
WAYBACK_SNAPSHOT_TIMEOUT_S = 60
# We probe at most this many snapshots before giving up — each one is
# ~200 KB compressed and the polite delay is 2s, so capping prevents the
# fallback from dominating run time when most snapshots are stub URLs.
WAYBACK_MAX_PROBES = 5
WAYBACK_INTER_PROBE_SLEEP_S = 2


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


def extract(text: str, terms: tuple[int, ...] = (15, 30)) -> dict:
    """Pull rate+APR for the requested terms. Returns a dict with whatever
    matched; keys for un-matched terms are present as None.

    Single-term URLs (Tier 1b/1c) only carry their own term, so passing a
    constrained `terms` argument keeps the page-mismatch noise out of logs.
    """
    out = {"term_15": None, "term_15_apr": None, "term_30": None, "term_30_apr": None}
    for term in terms:
        m = _row_pattern(term).search(text)
        if m:
            out[f"term_{term}"] = float(m.group(1))
            out[f"term_{term}_apr"] = float(m.group(2))
    return out


def _has_value(found: dict, term: int) -> bool:
    return found.get(f"term_{term}") is not None


def _merge(into: dict, other: dict, terms: tuple[int, ...]) -> None:
    """Copy any term-* values from `other` into `into` if the target slot is
    empty. Lets us bolt 30-yr from a 30-yr-only page onto a row that already
    has 15-yr from the 15-yr-only page."""
    for term in terms:
        if into.get(f"term_{term}") is None and other.get(f"term_{term}") is not None:
            into[f"term_{term}"] = other[f"term_{term}"]
            into[f"term_{term}_apr"] = other.get(f"term_{term}_apr")


def fetch_static(url: str, label: str) -> dict | None:
    """Tier 1*: one static urllib fetch. Returns extracted dict or None on
    failure (403, network error, or no rate values on the page)."""
    print(f"  Tier 1 [{label}] GET {url}")
    html = fetch_html(url, HEADERS, timeout=30)
    if html is None:
        print(f"  Tier 1 [{label}] HTTP failed", file=sys.stderr)
        return None
    text = _strip_html(html)
    found = extract(text)
    if not _has_value(found, 15) and not _has_value(found, 30):
        print(f"  Tier 1 [{label}] page returned but no rate values matched", file=sys.stderr)
        return None
    return found


def fetch_browser() -> dict | None:
    """Tier 2: Playwright with stealth + homepage warmup. Used only when
    every urllib fallback returned no rate values."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        print("  Tier 2: playwright not installed; skipping browser fallback", file=sys.stderr)
        return None
    print("  Tier 2: launching Playwright with stealth profile + homepage warmup")
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
                try:
                    page.goto(HOMEPAGE_URL, wait_until="domcontentloaded", timeout=GOTO_TIMEOUT_MS)
                    time.sleep(WARMUP_SLEEP_S)
                except PlaywrightTimeout:
                    print("  Tier 2: homepage warmup timed out; continuing", file=sys.stderr)
                try:
                    page.goto(URL_PRIMARY, wait_until="domcontentloaded", timeout=GOTO_TIMEOUT_MS)
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
                if "Unable to Process Request" in html:
                    print("  Tier 2: Akamai block page returned", file=sys.stderr)
                    return None
                text = _strip_html(html)
                found = extract(text)
                if not _has_value(found, 15) and not _has_value(found, 30):
                    print("  Tier 2: page rendered but no rate values matched", file=sys.stderr)
                    return None
                return found
            finally:
                browser.close()
    except Exception as e:  # broad: any Playwright launch / runtime failure
        print(f"  Tier 2 raised: {e}", file=sys.stderr)
        return None


def fetch_wayback() -> tuple[dict, str] | None:
    """Tier 3: most-recent Wayback CDX snapshot of any rocketmortgage
    /mortgage-rates* URL in the last `WAYBACK_LOOKBACK_DAYS`. Returns
    (rates_dict, snapshot_yyyymmdd) or None.

    The wildcard URL pattern matches both the canonical /mortgage-rates
    and the SEO landing pages — Rocket displays the same national rate
    on all of them, so any captured snapshot is usable. Snapshots are
    probed newest-first; each is gzip-decoded (the `id_` flag returns
    the original Content-Encoding) and run through the shared extractor.
    Stops once both terms are filled or we exhaust the probe budget.
    """
    today = dt.date.today()
    from_ymd = (today - dt.timedelta(days=WAYBACK_LOOKBACK_DAYS)).strftime("%Y%m%d")
    to_ymd = today.strftime("%Y%m%d")
    cdx = (
        f"http://web.archive.org/cdx/search/cdx?url=rocketmortgage.com/mortgage-rates*"
        f"&from={from_ymd}&to={to_ymd}&filter=statuscode:200&output=json&limit=30"
    )
    print(f"  Tier 3 [wayback] CDX query: last {WAYBACK_LOOKBACK_DAYS}d")
    try:
        req = urllib.request.Request(cdx, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=WAYBACK_CDX_TIMEOUT_S) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace") or "[]")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  Tier 3 CDX raised: {e}", file=sys.stderr)
        return None
    if not data or len(data) < 2:
        print(f"  Tier 3: no Wayback snapshots in last {WAYBACK_LOOKBACK_DAYS}d", file=sys.stderr)
        return None
    # CDX returns header row at index 0, then snapshots in chronological order.
    # Newest-first probe order lets us return on the freshest snapshot that
    # carries values, rather than picking up a stale partial first.
    snapshots = sorted(data[1:], key=lambda row: row[1], reverse=True)
    found: dict = {"term_15": None, "term_15_apr": None, "term_30": None, "term_30_apr": None}
    snapshot_date: str | None = None
    for i, row in enumerate(snapshots[:WAYBACK_MAX_PROBES]):
        ts = row[1]
        original = row[2]
        snap_url = f"https://web.archive.org/web/{ts}id_/{original}"
        print(f"  Tier 3 [wayback {ts[:8]}] GET {original[:70]}")
        try:
            req = urllib.request.Request(
                snap_url,
                headers={**HEADERS, "Accept-Encoding": "gzip, deflate"},
            )
            with urllib.request.urlopen(req, timeout=WAYBACK_SNAPSHOT_TIMEOUT_S) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    html = gzip.decompress(raw).decode("utf-8", errors="replace")
                else:
                    html = raw.decode("utf-8", errors="replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"  Tier 3 [wayback {ts[:8]}] fetch raised: {e}", file=sys.stderr)
            continue
        text = _strip_html(html)
        new_found = extract(text)
        before = (found["term_15"], found["term_30"])
        _merge(found, new_found, terms=(15, 30))
        # The snapshot_date attribution is the *first* snapshot that
        # contributed a non-null term — if later snapshots only fill the
        # other term, we still report the freshest contributor's date.
        if snapshot_date is None and (
            (_has_value(found, 15) and before[0] is None)
            or (_has_value(found, 30) and before[1] is None)
        ):
            snapshot_date = ts[:8]
        if _has_value(found, 15) and _has_value(found, 30):
            break
        # Polite delay before the next Wayback request.
        if i + 1 < min(WAYBACK_MAX_PROBES, len(snapshots)):
            time.sleep(WAYBACK_INTER_PROBE_SLEEP_S)
    if not _has_value(found, 15) and not _has_value(found, 30):
        print(f"  Tier 3: probed {min(WAYBACK_MAX_PROBES, len(snapshots))} snapshots, no rate values found", file=sys.stderr)
        return None
    return found, snapshot_date or "unknown"


def gather_rates() -> tuple[dict, str, str | None] | None:
    """Run the fallback chain. Returns (rates_dict, source_method, date_iso_override)
    or None when every tier failed. The date_iso_override is set only for
    Wayback hits (so the row lands in the snapshot's calendar month, not
    today's, which keeps the monthly aggregator honest).

    The method label encodes *which* tier filled the row:
      "static"          — Tier 1a (primary /mortgage-rates URL)
      "static_split"    — combination of Tier 1b + 1c (single-term pages)
      "static_seo"      — Tier 1d (per-state SEO landing page)
      "static_mixed"    — Tier 1a partial + a single-term page filling the gap
      "browser"         — Tier 2 (Playwright)
      "wayback_<YYYYMMDD>" — Tier 3 (Wayback CDX snapshot)
    """
    # Tier 1a — both terms on the canonical page.
    primary = fetch_static(URL_PRIMARY, "primary")
    if primary and _has_value(primary, 15) and _has_value(primary, 30):
        return primary, "static", None

    found: dict = primary or {"term_15": None, "term_15_apr": None, "term_30": None, "term_30_apr": None}

    # Tier 1b / 1c — single-term pages. Try whichever side is still missing.
    if not _has_value(found, 15):
        side = fetch_static(URL_15_ONLY, "15yr-only")
        if side:
            _merge(found, side, terms=(15,))
    if not _has_value(found, 30):
        side = fetch_static(URL_30_ONLY, "30yr-only")
        if side:
            _merge(found, side, terms=(30,))
    if _has_value(found, 15) and _has_value(found, 30):
        method = "static_split" if primary is None else "static_mixed"
        return found, method, None

    # Tier 1d — SEO landing pages. Rotate through candidates so Akamai
    # rate-limiting on one URL doesn't kill the whole fallback.
    for seo_url in URL_STATE_SEO_CANDIDATES:
        seo = fetch_static(seo_url, "state-seo")
        if seo:
            _merge(found, seo, terms=(15, 30))
            if _has_value(found, 15) and _has_value(found, 30):
                return found, "static_seo", None
            # Even partial: keep going to next SEO URL to fill the gap.

    # Tier 2 — Playwright. Will likely lose from datacenter IPs but
    # occasionally wins on residential ones during Akamai churn.
    print("  All urllib tiers exhausted; escalating to Tier 2 (browser)", file=sys.stderr)
    br = fetch_browser()
    if br:
        _merge(found, br, terms=(15, 30))
        if _has_value(found, 15) and _has_value(found, 30):
            return found, "browser", None
        # If browser only filled one term, fall through to Tier 3 to try
        # for the missing side rather than committing to a partial row.

    # Tier 3 — Wayback Machine. Sparse coverage (~2 snapshots/month) but
    # the monthly aggregator only needs one hit per month, so even a stale
    # snapshot keeps the chart bar non-null. The snapshot's own date is
    # threaded back so the row lands in the correct calendar month.
    print("  Tier 2 didn't fully resolve; escalating to Tier 3 (Wayback)", file=sys.stderr)
    wb = fetch_wayback()
    if wb:
        wb_found, snapshot_date = wb
        _merge(found, wb_found, terms=(15, 30))
        if _has_value(found, 15) or _has_value(found, 30):
            snapshot_iso = (
                f"{snapshot_date[0:4]}-{snapshot_date[4:6]}-{snapshot_date[6:8]}"
                if len(snapshot_date) == 8 else None
            )
            return found, f"wayback_{snapshot_date}", snapshot_iso

    # Partial-data salvage: if any prior tier filled at least one term
    # before the chain bottomed out, surface it rather than reporting a
    # total failure. A 30yr-only row is still chart-useful and keeps the
    # JSONL accumulator's trail going. The validator can still flag the
    # missing term separately.
    if _has_value(found, 15) or _has_value(found, 30):
        return found, "static_partial", None

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

    print("Fetching Rocket Mortgage national rates (multi-URL fallback) ...")
    result = gather_rates()
    if result is None:
        print("ERROR: all tiers failed for Rocket national page", file=sys.stderr)
        return 3
    found, source_method, snapshot_iso = result

    # Wayback hits report the snapshot's own date so the row lands in the
    # correct calendar month for the monthly aggregator. Live hits use today.
    date_iso = args.date_iso or snapshot_iso or dt.date.today().isoformat()
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
