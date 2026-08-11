"""One-shot: extract county FIPS -> name mapping from us-atlas counties-10m.json
into scripts/county_names.py.
"""
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
TOPO = os.path.join(here, "..", "node_modules", "us-atlas", "counties-10m.json")
OUT = os.path.join(here, "county_names.py")

# Counties that HMDA 2024 reports but us-atlas 3.0.1 does not carry.
#
# WHY: us-atlas 3.0.1 (current — bumping it does not help) ships 2017-vintage
# county geometry. Since then Connecticut replaced its eight counties with nine
# planning regions (09110-09190, effective 2022) and Alaska re-cut two census
# areas (02063 Chugach, 02066 Copper River, effective 2019). Without these
# entries fetch_hmda_state falls back to `f"FIPS {fips}"`, which is what put
# the literal text "FIPS 09110" on the state page's top-county cards.
#
# Names follow the us-atlas convention — bare, with no "County" / "Planning
# Region" / "Census Area" suffix — because that is what every other entry uses
# and what the frontend renders against.
#
# This is the NAME half only. The map geometry is still 2017-vintage, so CT's
# county choropleth remains grey; replacing it needs a 2023+ TIGER download
# and a new committed topo file, scoped separately.
EXTRA_NAMES: dict[str, str] = {
    # Alaska, post-2019 census areas
    "02063": "Chugach",
    "02066": "Copper River",
    # Connecticut, 2022 planning regions
    "09110": "Capitol",
    "09120": "Greater Bridgeport",
    "09130": "Lower Connecticut River Valley",
    "09140": "Naugatuck Valley",
    "09150": "Northeastern Connecticut",
    "09160": "Northwest Hills",
    "09170": "South Central Connecticut",
    "09180": "Southeastern Connecticut",
    "09190": "Western Connecticut",
}


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
    # Merge, don't overwrite: EXTRA_NAMES only fills gaps, so a future us-atlas
    # that DOES ship these keeps its own spelling and this stays a no-op.
    added = [k for k in EXTRA_NAMES if k not in names]
    names.update({k: v for k, v in EXTRA_NAMES.items() if k not in names})
    print(f"Added {len(added)} entry(ies) us-atlas does not carry: {sorted(added)}")
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
