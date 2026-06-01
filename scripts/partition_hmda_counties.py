"""Partition the HMDA CSV for a state into per-county distributions.

Reads the per-state HMDA CSV (currently NC only, at
C:\\Users\\akanc\\Documents\\hmda_nc_2024_home_purchase.csv), filters to
home-purchase originations, groups by county_code (5-digit FIPS), and
computes per-county summary stats for 15-yr and 30-yr loans.

Emits src/data/states/{slug}/counties.json with one entry per county:
  {
    "fips": "37183",
    "name": "Wake County",
    "term_15": {n_loans, simple_mean, weighted_mean, p10..p90, low_n},
    "term_30": {same}
  }

Min-n flag: counties with <30 loans for a term are still emitted but flagged
low_n: true for the UI.
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import RAW_HMDA_CSV, state_data_dir  # noqa: E402
from states import by_slug  # noqa: E402
from nc_county_names import NC_COUNTY_NAMES  # noqa: E402

LOW_N_THRESHOLD = 30


def summarize(rates: list[float], amounts: list[float]) -> dict:
    n = len(rates)
    if n == 0:
        return {"n_loans": 0}
    rates_sorted = sorted(rates)
    total_amt = sum(amounts)
    simple = sum(rates) / n
    weighted = sum(r * a for r, a in zip(rates, amounts)) / total_amt if total_amt > 0 else simple

    def pct(p: float) -> float:
        idx = max(0, min(n - 1, int(p * (n - 1))))
        return rates_sorted[idx]

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


def partition(slug: str) -> int:
    state = by_slug(slug)
    csv_path = RAW_HMDA_CSV
    if not os.path.exists(csv_path):
        print(f"ERROR: HMDA CSV not found at {csv_path}", file=sys.stderr)
        return 2

    # Per-county per-term accumulators: (county_fips, term) -> (rates, amounts)
    by_county: dict[tuple[str, int], dict[str, list[float]]] = {}

    total = 0
    matched = 0
    with open(csv_path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            if row.get("action_taken") != "1":
                continue
            if row.get("loan_purpose") != "1":
                continue
            term_str = row.get("loan_term", "")
            if term_str not in ("180", "360"):
                continue
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
            county = row.get("county_code", "").strip()
            if not county or county == "NA":
                continue
            term = 15 if term_str == "180" else 30
            key = (county, term)
            entry = by_county.setdefault(key, {"rates": [], "amounts": []})
            entry["rates"].append(rate)
            entry["amounts"].append(amt)
            matched += 1

    print(f"Processed {total:,} HMDA rows; matched {matched:,} clean originations across {sum(1 for k in by_county if k[1] == 15)} counties (15-yr) + {sum(1 for k in by_county if k[1] == 30)} counties (30-yr).")

    counties_by_fips: dict[str, dict] = {}
    for (fips, term), bucket in by_county.items():
        entry = counties_by_fips.setdefault(fips, {
            "fips": fips,
            "name": NC_COUNTY_NAMES.get(fips, f"FIPS {fips}"),
        })
        entry[f"term_{term}"] = summarize(bucket["rates"], bucket["amounts"])

    # Ensure every county has both term entries (empty if missing).
    for entry in counties_by_fips.values():
        for term in (15, 30):
            entry.setdefault(f"term_{term}", {"n_loans": 0})

    out_rows = sorted(counties_by_fips.values(), key=lambda r: r["name"])
    out = {
        "state_slug": state["slug"],
        "state_postal": state["postal"],
        "state_fips": state["fips"],
        "source": "FFIEC HMDA 2024 LAR public, action_taken=1, loan_purpose=1, term in {180, 360}",
        "low_n_threshold": LOW_N_THRESHOLD,
        "counties": out_rows,
    }
    out_dir = state_data_dir(slug)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "counties.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {len(out_rows)} counties -> {out_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="north-carolina")
    args = parser.parse_args()
    return partition(args.state)


if __name__ == "__main__":
    sys.exit(main())
