"""One-shot generator — not run by CI.

Re-apply scripts/county_names.py to the SHIPPED src/data/states/*/counties.json.

WHY THIS EXISTS
  fetch_hmda_state.emit() stamps each county's display name at ingest time via
  `COUNTY_NAMES.get(fips, f"FIPS {fips}")`. When a FIPS is missing from the
  map, the literal placeholder text "FIPS 09110" is baked into the shipped
  data and shown to users on the state page's top-county cards. Adding the
  name to county_names.py therefore fixes nothing already on disk — the only
  normal way to re-stamp it is to re-run the annual HMDA ingest, which
  re-downloads ~3.5 million rows per state over the network.

  This does the same relabel offline and deterministically.

SAFETY
  It rewrites a name ONLY when the current value is exactly the
  `FIPS <fips>` placeholder AND county_names.py now has a real name for that
  FIPS. It can therefore never overwrite a genuine name, and re-running it is
  a no-op. Nothing but the `name` field is touched.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import STATES_DIR  # noqa: E402
from county_names import COUNTY_NAMES  # noqa: E402


def relabel_file(path: str) -> list[tuple[str, str, str]]:
    """Return the (fips, old, new) triples applied to one counties.json."""
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    changes: list[tuple[str, str, str]] = []
    for c in doc.get("counties", []):
        fips = c.get("fips", "")
        real = COUNTY_NAMES.get(fips)
        if real and c.get("name") == f"FIPS {fips}":
            changes.append((fips, c["name"], real))
            c["name"] = real
    if changes:
        doc["counties"].sort(key=lambda r: r["name"])  # emit() sorts by name
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2)
    return changes


def main() -> int:
    if not os.path.isdir(STATES_DIR):
        print(f"No states dir at {STATES_DIR}", file=sys.stderr)
        return 1
    total = 0
    for slug in sorted(os.listdir(STATES_DIR)):
        path = os.path.join(STATES_DIR, slug, "counties.json")
        if not os.path.exists(path):
            continue
        for fips, old, new in relabel_file(path):
            print(f"  {slug}: {old} -> {new}")
            total += 1
    print(f"Relabelled {total} county name(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
