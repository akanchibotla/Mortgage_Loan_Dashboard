"""4.7 — the homepage hero literals must match what actually ships.

HomePage.tsx hardcodes two dataset-size claims. They were written against an
earlier ingest and drifted: "3,141 counties" and "~7M HMDA closed loans"
against a real 3,128 counties and 2,904,579 originations — a 2.4x overstatement
of the headline number on the front page.

Keeping them as literals is the right call (the 2025 LAR ingest is a
"do not extend" event, so a runtime count would be new machinery for a number
that changes once a year). This test is the price of that choice: the literals
are pinned to disk, so they cannot rot silently again.

NOTE FOR WHOEVER SEES THIS FAIL: the fix is to correct the LITERAL in
HomePage.tsx, never to relax this test. The counts below are computed from the
shipped JSON on every run — they are not themselves hardcoded.
"""
import glob
import json
import os
import re

import pytest


def _measured(repo_root: str) -> tuple[int, int]:
    """(total originations, distinct county FIPS) across the shipped data."""
    states = os.path.join(repo_root, "src", "data", "states")
    total = sum(
        json.load(open(p, encoding="utf-8"))["n_loans"]
        for p in glob.glob(os.path.join(states, "*", "hmda_2024_*yr.json"))
    )
    fips = {
        c["fips"]
        for p in glob.glob(os.path.join(states, "*", "counties.json"))
        for c in json.load(open(p, encoding="utf-8"))["counties"]
    }
    return total, len(fips)


@pytest.fixture
def homepage(repo_root):
    p = os.path.join(repo_root, "src", "pages", "HomePage.tsx")
    if not os.path.exists(p):
        pytest.skip("HomePage.tsx not present")
    return open(p, encoding="utf-8").read()


def test_measured_counts_are_stable(repo_root):
    """Guards the guard: if this drifts, the two tests below need new values,
    not a shrug."""
    total, counties = _measured(repo_root)
    assert (total, counties) == (2_904_579, 3_128), \
        f"shipped dataset size changed to {total:,} loans / {counties:,} counties"


def test_county_count_literal_matches_disk(repo_root, homepage):
    _, counties = _measured(repo_root)
    labelled = re.search(
        r'<div className="stat-value">([\d,]+)</div>\s*'
        r'<div className="stat-label">counties partitioned</div>',
        homepage,
    )
    assert labelled, "could not find the 'counties partitioned' stat card in HomePage.tsx"
    shown = int(labelled.group(1).replace(",", ""))
    assert shown == counties, (
        f"HomePage says {shown:,} counties partitioned; the shipped data has "
        f"{counties:,}. Fix the literal in HomePage.tsx."
    )


def test_loan_count_literal_matches_disk(repo_root, homepage):
    total, _ = _measured(repo_root)
    card = re.search(
        r'<div className="stat-value">\s*~?([\d.]+)\s*'
        r'<span className="stat-value-sub">M</span>\s*</div>\s*'
        r'<div className="stat-label">HMDA closed loans</div>',
        homepage,
    )
    assert card, "could not find the 'HMDA closed loans' stat card in HomePage.tsx"
    shown_millions = float(card.group(1))
    expected_millions = round(total / 1_000_000, 1)
    assert shown_millions == expected_millions, (
        f"HomePage says {shown_millions}M HMDA closed loans; the shipped data "
        f"has {total:,} ({expected_millions}M). Fix the literal in HomePage.tsx."
    )
