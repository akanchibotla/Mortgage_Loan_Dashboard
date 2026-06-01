"""Fetch today's NC mortgage rates from Bankrate's NC page.

Extracts both the intro-sentence rate and the purchase-table rate for 15-yr
and 30-yr fixed, plus the "as of" date stamp. Saves to
src/data/nc_bankrate_live_today.json. Best-effort: prints a warning and exits
non-zero on failure rather than emitting partial data.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

URL = "https://www.bankrate.com/mortgages/mortgage-rates/north-carolina/"
OUT_PATH = r"c:\GitHub\Mortgage_Loan_Dashboard\src\data\nc_bankrate_live_today.json"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in North Carolina"
)


def table_pattern(term: int) -> re.Pattern[str]:
    return re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</th>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )


def intro_pattern(term: int) -> re.Pattern[str]:
    return re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")


def fetch_html() -> str:
    req = urllib.request.Request(URL, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        print(f"ERROR: Bankrate returned HTTP {e.code}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"ERROR: Bankrate fetch failed: {e}", file=sys.stderr)
        sys.exit(2)


def main():
    text = fetch_html()
    date_m = DATE_INTRO_PAT.search(text)
    as_of = date_m.group(1) if date_m else None

    out = {"fetched_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"), "as_of": as_of}
    any_real_value = False
    for term in (15, 30):
        table_m = table_pattern(term).search(text)
        intro_m = intro_pattern(term).search(text)
        table_pct = float(table_m.group(1)) if table_m else None
        intro_pct = float(intro_m.group(1)) if intro_m else None
        # Bankrate now renders rates via client-side JS; raw HTML serves 0.00% placeholders.
        # Treat any value <= 0.5% as the placeholder and surface it as missing.
        if table_pct is not None and table_pct <= 0.5:
            table_pct = None
        if intro_pct is not None and intro_pct <= 0.5:
            intro_pct = None
        if table_pct is not None or intro_pct is not None:
            any_real_value = True
        out[f"term_{term}"] = {"table_pct": table_pct, "intro_pct": intro_pct}
        print(f"  {term}-yr  table={table_pct}  intro={intro_pct}")

    if not any_real_value:
        print(
            "WARNING: Bankrate now serves placeholder 0.00% values in the raw HTML "
            "(values are hydrated by client-side JS). Update the trailing-month "
            "constants in reconcile_nc.py manually after checking the rendered page.",
            file=sys.stderr,
        )
        out["needs_manual_refresh"] = True

    print(f"as_of: {as_of}")
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Saved -> {OUT_PATH}")


if __name__ == "__main__":
    main()
