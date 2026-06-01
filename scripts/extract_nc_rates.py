"""Extract Bankrate NC 15-yr and 30-yr fixed PURCHASE rates from
archived Wayback snapshots in bankrate_nc_archive2/.

Anchor: the table-row link href containing '{term}-year-mortgage-rates'
       (refinance lives under '{term}-year-refinance-rates' and is excluded).
Date: the intro paragraph 'current interest rates in North Carolina' sentence
      includes a day-stamped date.
"""
import re
import os
import glob
import json

SNAP_DIR = r"C:\Users\akanc\Documents\bankrate_nc_archive2"
OUT_DIR = r"c:\GitHub\Mortgage_Loan_Dashboard\src\data"

DATE_INTRO_PAT = re.compile(
    r"([A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),?\s+current interest rates in North Carolina"
)


def extract(term: int) -> list:
    """Pull bankrate_table_pct and bankrate_intro_pct for the given term from each monthly snapshot."""
    # Table row: <a ... href=".../{term}-year-mortgage-rates/">{term}-Year Fixed Rate</a></th>
    #            <td class="text-right">X.YZ%</td>
    table_pat = re.compile(
        rf"{term}-year-mortgage-rates/[^>]*>[^<]*</a>\s*</th>\s*<td[^>]*>\s*(\d\.\d{{2,3}})\s*%",
        re.IGNORECASE,
    )
    # Intro mentions both terms in one sentence:
    # "... are 7.19% for a 30-year fixed mortgage and 6.69% for a 15-year fixed mortgage."
    intro_pat = re.compile(rf"(\d\.\d{{2,3}})\s*%\s+for a {term}-year fixed mortgage")

    files = sorted(glob.glob(os.path.join(SNAP_DIR, "20??-??.html")))
    results = []
    for path in files:
        month_label = os.path.splitext(os.path.basename(path))[0]  # "2024-06"
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()

        table_m = table_pat.search(text)
        intro_m = intro_pat.search(text)
        date_m = DATE_INTRO_PAT.search(text)

        results.append({
            "month": month_label,
            "as_of": date_m.group(1) if date_m else None,
            "bankrate_table_pct": float(table_m.group(1)) if table_m else None,
            "bankrate_intro_pct": float(intro_m.group(1)) if intro_m else None,
        })
        print(f"  {month_label}  table={table_m.group(1) if table_m else 'N/A':>5}  intro={intro_m.group(1) if intro_m else 'N/A':>5}  as_of={date_m.group(1) if date_m else 'N/A'}")
    return results


for term in (15, 30):
    print(f"\n=== {term}-yr NC purchase rates ===")
    rows = extract(term)
    out_path = os.path.join(OUT_DIR, f"nc_bankrate_{term}yr_dense.json")
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Saved {len(rows)} rows -> nc_bankrate_{term}yr_dense.json")
