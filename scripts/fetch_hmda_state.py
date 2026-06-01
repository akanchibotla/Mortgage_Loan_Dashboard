"""Download a state's filtered HMDA 2024 LAR CSV from FFIEC's data browser
and emit per-state HMDA summaries + per-county distributions.

The FFIEC `/v2/data-browser-api/view/csv` endpoint returns a 301 redirect
to a signed S3 URL. urllib follows redirects by default.

Filter applied: action_taken=1 (originated) + loan_purpose=1 (home purchase).
Term split (15 vs 30) is done client-side after download so a single
download serves both summaries + the county file.

Outputs per state (overwrites previous):
  src/data/states/{slug}/hmda_2024_15yr.json
  src/data/states/{slug}/hmda_2024_30yr.json
  src/data/states/{slug}/counties.json
  (and flips state_meta.has_hmda_band -> true via reconcile_state.py rerun)
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import state_data_dir  # noqa: E402
from states import by_slug  # noqa: E402
from county_names import COUNTY_NAMES  # noqa: E402

LOW_N_THRESHOLD = 30
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 MortgageDashboard/1.0"
    ),
    "Accept": "text/csv,application/octet-stream,*/*",
    "Referer": "https://ffiec.cfpb.gov/data-browser/",
    "Origin": "https://ffiec.cfpb.gov",
}


def url_for(postal: str) -> str:
    return (
        "https://ffiec.cfpb.gov/v2/data-browser-api/view/csv"
        f"?states={postal}&years=2024&actions_taken=1&loan_purposes=1"
    )


def download(postal: str, dest_path: str) -> int:
    """Use curl via subprocess. Python's urllib redirect handler strips headers
    in a way that the signed-S3 redirect target rejects with 403."""
    url = url_for(postal)
    print(f"Downloading HMDA for {postal} from {url}")
    curl = shutil.which("curl")
    if not curl:
        print("ERROR: curl not on PATH; required for HMDA download", file=sys.stderr)
        return -1
    cmd = [
        curl,
        "-sL",
        "--fail",
        "-A", HEADERS["User-Agent"],
        "-H", f"Accept: {HEADERS['Accept']}",
        "-H", f"Referer: {HEADERS['Referer']}",
        "-H", f"Origin: {HEADERS['Origin']}",
        "--max-time", "1200",
        "-o", dest_path,
        url,
    ]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"  curl returncode {result.returncode}", file=sys.stderr)
        return -1
    total = os.path.getsize(dest_path)
    print(f"  Done: {total / 1024 / 1024:.1f} MB")
    return total


def summarize(rates: list[float], amounts: list[float]) -> dict:
    n = len(rates)
    if n == 0:
        return {"n_loans": 0}
    s = sorted(rates)
    total_amt = sum(amounts)
    simple = sum(rates) / n
    weighted = sum(r * a for r, a in zip(rates, amounts)) / total_amt if total_amt > 0 else simple

    def pct(p: float) -> float:
        return s[max(0, min(n - 1, int(p * (n - 1))))]

    return {
        "n_loans": n,
        "simple_mean_pct": round(simple, 3),
        "amount_weighted_mean_pct": round(weighted, 3),
        "p10_pct": round(pct(0.10), 3),
        "p25_pct": round(pct(0.25), 3),
        "p50_pct": round(pct(0.50), 3),
        "p75_pct": round(pct(0.75), 3),
        "p90_pct": round(pct(0.90), 3),
        "low_n": n < LOW_N_THRESHOLD,
    }


def state_summary(rates: list[float], amounts: list[float], state: dict, term: int) -> dict:
    s = summarize(rates, amounts)
    s["source"] = (
        f"HMDA 2024 LAR public (FFIEC), {state['postal']}, "
        f"loan_purpose=home_purchase, action_taken=originated, "
        f"loan_term={'180' if term == 15 else '360'}"
    )
    return s


def process_csv(csv_path: str, state: dict) -> dict:
    """Stream-process the CSV and return aggregated per-county and per-term data."""
    # state-level accumulators
    state_15: dict[str, list[float]] = {"rates": [], "amounts": []}
    state_30: dict[str, list[float]] = {"rates": [], "amounts": []}
    # per-county (per term): {fips: {15: {rates, amounts}, 30: {rates, amounts}}}
    counties: dict[str, dict[int, dict[str, list[float]]]] = {}

    total = 0
    kept = 0
    with open(csv_path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            term_str = row.get("loan_term", "")
            if term_str not in ("180", "360"):
                continue
            term = 15 if term_str == "180" else 30
            if row.get("reverse_mortgage") not in (None, "", "2"):
                continue
            if row.get("open-end_line_of_credit") not in (None, "", "2"):
                continue
            if row.get("business_or_commercial_purpose") not in (None, "", "2"):
                continue
            rate_str = row.get("interest_rate", "")
            if not rate_str or rate_str in ("NA", "Exempt"):
                continue
            try:
                rate = float(rate_str)
                amt = float(row.get("loan_amount") or 0) or 0.0
            except ValueError:
                continue
            if not (0.5 < rate < 25.0):
                continue
            (state_15 if term == 15 else state_30)["rates"].append(rate)
            (state_15 if term == 15 else state_30)["amounts"].append(amt)
            county = row.get("county_code", "").strip()
            if county and county != "NA":
                bucket = counties.setdefault(county, {15: {"rates": [], "amounts": []}, 30: {"rates": [], "amounts": []}})
                bucket[term]["rates"].append(rate)
                bucket[term]["amounts"].append(amt)
            kept += 1

    print(f"Processed {total:,} rows; kept {kept:,} clean originations; {len(counties)} counties.")
    return {
        "state_15": state_summary(state_15["rates"], state_15["amounts"], state, 15),
        "state_30": state_summary(state_30["rates"], state_30["amounts"], state, 30),
        "counties": counties,
        "n_state_15": len(state_15["rates"]),
        "n_state_30": len(state_30["rates"]),
    }


def emit(slug: str, state: dict, result: dict) -> None:
    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)

    # Make sure a state_meta.json exists so the dashboard index picks this state up.
    meta_path = os.path.join(out_dir, "state_meta.json")
    if not os.path.exists(meta_path):
        with open(meta_path, "w") as f:
            json.dump({
                "slug": state["slug"],
                "postal": state["postal"],
                "fips": state["fips"],
                "name": state["name"],
                "built_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
                "has_hmda_band": True,
                "live_trailing": False,
            }, f, indent=2)

    with open(os.path.join(out_dir, "hmda_2024_15yr.json"), "w") as f:
        json.dump(result["state_15"], f, indent=2)
    with open(os.path.join(out_dir, "hmda_2024_30yr.json"), "w") as f:
        json.dump(result["state_30"], f, indent=2)

    county_rows = []
    for fips, terms in sorted(result["counties"].items()):
        name = COUNTY_NAMES.get(fips, f"FIPS {fips}")
        county_rows.append({
            "fips": fips,
            "name": name,
            "term_15": summarize(terms[15]["rates"], terms[15]["amounts"]),
            "term_30": summarize(terms[30]["rates"], terms[30]["amounts"]),
        })
    county_rows.sort(key=lambda r: r["name"])

    counties_file = {
        "state_slug": state["slug"],
        "state_postal": state["postal"],
        "state_fips": state["fips"],
        "source": "FFIEC HMDA 2024 LAR public, action_taken=1, loan_purpose=1, term in {180, 360}",
        "low_n_threshold": LOW_N_THRESHOLD,
        "built_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "counties": county_rows,
    }
    with open(os.path.join(out_dir, "counties.json"), "w") as f:
        json.dump(counties_file, f, indent=2)

    print(f"  Wrote: hmda_2024_15yr.json (n={result['n_state_15']:,}) + hmda_2024_30yr.json (n={result['n_state_30']:,}) + counties.json ({len(county_rows)} counties)")


def fetch_one(slug: str, keep_csv: bool = False) -> int:
    state = by_slug(slug)
    tmp = tempfile.NamedTemporaryFile(prefix=f"hmda_{slug}_", suffix=".csv", delete=False)
    tmp.close()
    try:
        size = download(state["postal"], tmp.name)
        if size <= 0:
            return 1
        result = process_csv(tmp.name, state)
        emit(slug, state, result)
        return 0
    finally:
        if not keep_csv and os.path.exists(tmp.name):
            os.unlink(tmp.name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", help="single state slug")
    parser.add_argument("--all", action="store_true", help="fetch for every bundled state")
    parser.add_argument("--all-registry", action="store_true", help="fetch for every state in scripts/states.py")
    parser.add_argument("--keep-csv", action="store_true")
    args = parser.parse_args()
    if args.all:
        from _paths import STATES_DIR
        slugs = sorted(os.listdir(STATES_DIR)) if os.path.isdir(STATES_DIR) else []
        rc = 0
        for slug in slugs:
            print(f"\n=== {slug} ===")
            r = fetch_one(slug, keep_csv=args.keep_csv)
            if r != 0:
                rc = r
        return rc
    if args.all_registry:
        from states import STATES
        rc = 0
        for s in STATES:
            print(f"\n=== {s['slug']} ===")
            r = fetch_one(s["slug"], keep_csv=args.keep_csv)
            if r != 0:
                rc = r
        return rc
    if not args.state:
        parser.error("--state or --all required")
    return fetch_one(args.state, keep_csv=args.keep_csv)


if __name__ == "__main__":
    sys.exit(main())
