"""4.6 — the counties.json <-> topo geometry join.

us-atlas 3.0.1 ships 2017-vintage county geometry (bumping it does not help;
3.0.1 is current), while HMDA 2024 reports Connecticut's 2022 planning regions
(09110-09190) and Alaska's post-2019 census areas (02063, 02066). Those 11
counties therefore have data but no shape: CT's county choropleth is fully
grey and unclickable.

The geometry replacement is deliberately NOT done — it needs a 2023+ TIGER
download and new committed data files, scoped as its own decision. So this
test does not assert an empty gap, which would simply be red. It asserts the
gap is EXACTLY the 11 known FIPS: any new drift fails immediately, and if the
geometry is ever replaced this test fails too and must be updated to a tighter
bound. Either way the drift can no longer ship silently.
"""
import glob
import json
import os

# The known, accepted gap. Do not grow this list to make a failure go away —
# a new entry here means real counties silently stopped rendering.
KNOWN_MISSING_GEOMETRY = {
    # Alaska, re-cut census areas (effective 2019)
    "02063", "02066",
    # Connecticut, planning regions replacing the eight counties (effective 2022)
    "09110", "09120", "09130", "09140", "09150",
    "09160", "09170", "09180", "09190",
}


def _topo_feature_ids(path: str) -> set[str]:
    doc = json.load(open(path, encoding="utf-8"))
    return {str(f.get("id", "")).zfill(5) for f in doc["counties"]["features"]}


def _gap(repo_root: str) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    pattern = os.path.join(repo_root, "src", "data", "states", "*", "counties.json")
    for p in sorted(glob.glob(pattern)):
        slug = os.path.basename(os.path.dirname(p))
        doc = json.load(open(p, encoding="utf-8"))
        fips = {c["fips"] for c in doc["counties"]}
        topo = os.path.join(repo_root, "src", "data", "topo", f"{doc['state_fips']}.json")
        assert os.path.exists(topo), f"{slug}: no topo file at {topo}"
        missing = fips - _topo_feature_ids(topo)
        if missing:
            out[slug] = missing
    return out


def test_no_unexpected_county_geometry_drift(repo_root):
    gap = _gap(repo_root)
    unexpected = {s: sorted(m - KNOWN_MISSING_GEOMETRY) for s, m in gap.items()}
    unexpected = {s: m for s, m in unexpected.items() if m}
    assert unexpected == {}, \
        f"counties with data but no geometry, beyond the known CT/AK gap: {unexpected}"


def test_the_known_gap_has_not_silently_been_fixed_or_grown(repo_root):
    """If this fails because the gap SHRANK, that is good news — replace the
    allowlist with the smaller set (or delete it, and assert an empty gap)."""
    actual = set().union(*_gap(repo_root).values()) if _gap(repo_root) else set()
    assert actual == KNOWN_MISSING_GEOMETRY, (
        f"the known geometry gap changed.\n"
        f"  now missing but not allowlisted: {sorted(actual - KNOWN_MISSING_GEOMETRY)}\n"
        f"  allowlisted but now joined:      {sorted(KNOWN_MISSING_GEOMETRY - actual)}"
    )


def test_every_county_has_a_real_name(repo_root):
    """Section 3 step 1: the `FIPS 09110` placeholder text used to reach the
    state page's top-county cards for all 11 of these."""
    placeholders = []
    pattern = os.path.join(repo_root, "src", "data", "states", "*", "counties.json")
    for p in sorted(glob.glob(pattern)):
        slug = os.path.basename(os.path.dirname(p))
        for c in json.load(open(p, encoding="utf-8"))["counties"]:
            if c["name"].startswith("FIPS "):
                placeholders.append((slug, c["fips"], c["name"]))
    assert placeholders == [], f"unnamed counties still shipping: {placeholders}"


def test_county_names_map_covers_every_shipped_county(repo_root):
    """The map is the source of truth the next annual ingest stamps names
    from; a gap here is what produces a placeholder in the first place."""
    from county_names import COUNTY_NAMES

    missing = []
    pattern = os.path.join(repo_root, "src", "data", "states", "*", "counties.json")
    for p in sorted(glob.glob(pattern)):
        for c in json.load(open(p, encoding="utf-8"))["counties"]:
            if c["fips"] not in COUNTY_NAMES:
                missing.append(c["fips"])
    assert missing == [], f"FIPS shipped with no entry in county_names.py: {sorted(set(missing))}"
