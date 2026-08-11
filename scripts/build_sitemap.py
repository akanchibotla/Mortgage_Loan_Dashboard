"""Generate public/sitemap.xml.

The site is a HashRouter SPA, so every route is a FRAGMENT of one document.
Crawlers discard the fragment, which means the 2,684 `#/state/...` and
`#/state/.../county/...` entries this used to emit all collapsed to the single
base URL — 2,685 lines of daily churn advertising 2,685 URLs that resolve to
one. Emitting just the base URL says the same thing honestly.

That is a documentation fix, not an SEO regression: per-route indexing needs
build-time prerendering (or BrowserRouter + a 404 shim), which is an
architecture change and explicitly out of scope. See ROADMAP.

`lastmod` likewise comes from the DATA's own newest observation date, not
`date.today()`: a wall-clock stamp rewrote the file on every run whether or
not anything had changed.
"""
import datetime as dt
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import REPO_ROOT, STATES_DIR  # noqa: E402

BASE = "https://akanchibotla.github.io/Mortgage_Loan_Dashboard/"


def data_lastmod() -> str:
    """Newest observation date across the shipped daily views.

    This is the date the site's CONTENT last changed. Falls back to today only
    when no daily view exists at all (a fresh checkout mid-bootstrap).
    """
    newest = ""
    for path in glob.glob(os.path.join(STATES_DIR, "*", "*_daily.json")):
        try:
            with open(path, encoding="utf-8") as f:
                rows = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(rows, list) and rows:
            d = rows[-1].get("date")
            if isinstance(d, str) and d > newest:
                newest = d
    return newest or dt.date.today().isoformat()


def main() -> int:
    lastmod = data_lastmod()
    urls: list[tuple[str, str]] = [(BASE, lastmod)]

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
