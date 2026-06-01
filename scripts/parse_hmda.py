"""Compute HMDA 2024 NC 15-yr (loan_term=180) home-purchase originated mean interest rate.

Volume-weighted by loan_amount AND simple mean. Both for transparency.
"""
import csv
import os

path = r"C:\Users\akanc\Documents\hmda_nc_2024_home_purchase.csv"

# Sanity counters
total = 0
matched = 0
rate_missing = 0
rates = []
weights = []

with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total += 1
        if row.get("loan_term") != "360" and row.get("loan_term") != "180":
            pass  # we'll only filter the 180 below; let it pass for now
        if row.get("loan_term") != "180":
            continue
        # Confirm action_taken=1 (originated) — already filtered server-side
        if row.get("action_taken") != "1":
            continue
        # Defensive: confirm loan_purpose=1 (home purchase). The CSV filename suggests
        # it was pre-filtered, but the script shouldn't trust the filename.
        if row.get("loan_purpose") != "1":
            continue
        # Reverse mortgage / open-end / business-purpose loans typically have weird rates;
        # exclude to focus on standard 15-yr purchase.
        if row.get("reverse_mortgage") not in (None, "", "2"):
            # 2 = "Not a reverse mortgage"
            continue
        if row.get("open-end_line_of_credit") not in (None, "", "2"):
            continue
        if row.get("business_or_commercial_purpose") not in (None, "", "2"):
            continue
        rate_str = row.get("interest_rate", "")
        amt_str = row.get("loan_amount", "")
        if not rate_str or rate_str in ("NA", "Exempt"):
            rate_missing += 1
            continue
        try:
            r = float(rate_str)
            amt = float(amt_str) if amt_str and amt_str != "NA" else 0.0
        except ValueError:
            rate_missing += 1
            continue
        # Sanity: filter clearly bad rates (HMDA sometimes has 0 or extreme values)
        if not (0.5 < r < 25.0):
            continue
        rates.append(r)
        weights.append(amt)
        matched += 1

simple_mean = sum(rates) / len(rates) if rates else 0.0
total_amt = sum(weights)
weighted_mean = sum(r * w for r, w in zip(rates, weights)) / total_amt if total_amt else 0.0

# Distribution snapshot
sorted_rates = sorted(rates)
n = len(sorted_rates)
def pct(p):
    return sorted_rates[int(p * (n - 1))] if n else 0.0

print(f"Total rows in CSV: {total}")
print(f"15-yr originated (term=180), clean rate: {matched}")
print(f"Rate-missing (NA/Exempt) skipped: {rate_missing}")
print()
print(f"Simple mean interest rate:   {simple_mean:.4f}%")
print(f"Loan-amount-weighted mean:   {weighted_mean:.4f}%")
print()
print(f"Distribution (loan-amount-weighted analysis NOT applied to percentiles below — simple):")
print(f"  min:  {sorted_rates[0]:.3f}%")
print(f"  p10:  {pct(0.10):.3f}%")
print(f"  p25:  {pct(0.25):.3f}%")
print(f"  p50:  {pct(0.50):.3f}%")
print(f"  p75:  {pct(0.75):.3f}%")
print(f"  p90:  {pct(0.90):.3f}%")
print(f"  max:  {sorted_rates[-1]:.3f}%")

import json
out = {
    "source": "HMDA 2024 LAR public (FFIEC), NC, loan_purpose=home_purchase, action_taken=originated, loan_term=180",
    "n_loans": matched,
    "simple_mean_pct": round(simple_mean, 3),
    "amount_weighted_mean_pct": round(weighted_mean, 3),
    "p10_pct": round(pct(0.10), 3),
    "p25_pct": round(pct(0.25), 3),
    "p50_pct": round(pct(0.50), 3),
    "p75_pct": round(pct(0.75), 3),
    "p90_pct": round(pct(0.90), 3),
}
with open(r"c:\GitHub\Mortgage_Loan_Dashboard\src\data\hmda_nc_2024_15yr_summary.json", "w") as f:
    json.dump(out, f, indent=2)
print("\nSaved hmda_nc_2024_15yr_summary.json")
