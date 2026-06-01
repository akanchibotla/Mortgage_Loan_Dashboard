"""One-shot: extract county FIPS -> name mapping from us-atlas counties-10m.json
into scripts/county_names.py.
"""
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
TOPO = os.path.join(here, "..", "node_modules", "us-atlas", "counties-10m.json")
OUT = os.path.join(here, "county_names.py")


def main() -> int:
    with open(TOPO, "r", encoding="utf-8") as f:
        topo = json.load(f)
    names: dict[str, str] = {}
    for g in topo["objects"]["counties"]["geometries"]:
        fips = str(g.get("id", "")).zfill(5)
        name = g.get("properties", {}).get("name", "")
        if fips and name:
            names[fips] = name
    print(f"Extracted {len(names)} counties from us-atlas")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write('"""National county FIPS -> name map, extracted from us-atlas counties-10m.json."""\n')
        f.write("COUNTY_NAMES: dict[str, str] = {\n")
        for k in sorted(names):
            f.write(f"    {k!r}: {names[k]!r},\n")
        f.write("}\n")
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
