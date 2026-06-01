"""Generate public/sitemap.xml listing all state and county pages.

URLs use the HashRouter convention; Google's renderer follows hashes via the
sitemap. Run after build_states_index.py so we know which states/counties are
bundled.
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import REPO_ROOT, STATES_DIR, STATES_INDEX_JSON  # noqa: E402

BASE = "https://akanchibotla.github.io/Mortgage_Loan_Dashboard/"


def main() -> int:
    today = dt.date.today().isoformat()
    urls: list[tuple[str, str]] = [
        (BASE, today),
        (f"{BASE}#/calculator", today),
    ]

    if os.path.exists(STATES_INDEX_JSON):
        with open(STATES_INDEX_JSON) as f:
            idx = json.load(f)
        for s in idx["states"]:
            urls.append((f"{BASE}#/state/{s['slug']}", today))
            counties_path = os.path.join(STATES_DIR, s["slug"], "counties.json")
            if not os.path.exists(counties_path):
                continue
            with open(counties_path) as f:
                cf = json.load(f)
            for c in cf["counties"]:
                if (c["term_30"].get("n_loans") or 0) >= 30 or (c["term_15"].get("n_loans") or 0) >= 30:
                    urls.append((f"{BASE}#/state/{s['slug']}/county/{c['fips']}", today))

    sitemap_lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                     '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, lastmod in urls:
        sitemap_lines.append("  <url>")
        sitemap_lines.append(f"    <loc>{url}</loc>")
        sitemap_lines.append(f"    <lastmod>{lastmod}</lastmod>")
        sitemap_lines.append("  </url>")
    sitemap_lines.append("</urlset>")

    public_dir = os.path.join(REPO_ROOT, "public")
    os.makedirs(public_dir, exist_ok=True)
    out_path = os.path.join(public_dir, "sitemap.xml")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sitemap_lines) + "\n")
    print(f"Wrote {len(urls)} URLs to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
