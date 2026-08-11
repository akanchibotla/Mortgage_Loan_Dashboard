"""4.5 — HMDA guards.

(a) A download that isn't a LAR CSV, or that parses to zero qualifying loans,
    must NOT reach emit(). emit() rewrites four shipped JSONs unconditionally,
    and the annual LAR costs 3.5M rows a state to re-fetch.
(b) Every demographics dimension's bucket counts must sum to the state
    n_loans — the check that catches rows silently falling out of a bucketing
    table (the >$1M loan-amount bracket dropped 709 of them).
"""
import glob
import json
import os

import fetch_hmda_state as fh

HTML_BODY = b"<html><body>Service Unavailable</body></html>\n"
LAR_HEADER = (
    "activity_year,loan_term,interest_rate,reverse_mortgage,"
    "open-end_line_of_credit,business_or_commercial_purpose,loan_amount,"
    "county_code,derived_race,derived_ethnicity,derived_sex\n"
)


def _emit_tripwire(monkeypatch):
    """Make any emit() call an unambiguous test failure."""
    calls = []
    monkeypatch.setattr(fh, "emit", lambda *a, **k: calls.append(a))
    return calls


def test_html_body_refuses_to_emit(tmp_path, monkeypatch):
    """The 43-byte-HTML-body scenario, end to end through fetch_one()."""
    def fake_download(postal, dest_path):
        with open(dest_path, "wb") as f:
            f.write(HTML_BODY)
        return len(HTML_BODY)

    monkeypatch.setattr(fh, "download", fake_download)
    calls = _emit_tripwire(monkeypatch)

    rc = fh.fetch_one("north-carolina")

    assert rc == 2, f"expected non-zero exit, got {rc}"
    assert calls == [], "emit() must not run on a non-LAR body"


def test_html_body_fails_shape_check(tmp_path):
    p = tmp_path / "body.csv"
    p.write_bytes(HTML_BODY)
    assert fh.looks_like_lar_csv(str(p)) is False


def test_real_lar_header_passes_shape_check(tmp_path):
    p = tmp_path / "body.csv"
    p.write_text(LAR_HEADER, encoding="utf-8")
    assert fh.looks_like_lar_csv(str(p)) is True


def test_zero_qualifying_rows_refuses_to_emit(tmp_path, monkeypatch):
    """A well-formed LAR CSV whose every row is filtered out must not emit."""
    csv_path = tmp_path / "cache" / "hmda_north-carolina_2024.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    # Valid header, one row with an out-of-scope term -> 0 kept.
    csv_path.write_text(
        LAR_HEADER + "2024,120,6.5,2,2,2,250000,37183,White,Not Hispanic or Latino,Male\n",
        encoding="utf-8",
    )
    # Force the cached-file branch (size check) by stubbing getsize.
    monkeypatch.setattr(fh.os.path, "getsize", lambda p: 2_000_000)
    calls = _emit_tripwire(monkeypatch)

    rc = fh.fetch_one("north-carolina", cache_dir=str(csv_path.parent))

    assert rc == 2, f"expected non-zero exit, got {rc}"
    assert calls == [], "emit() must not run on a 0-row parse"


def test_valid_rows_do_emit(tmp_path, monkeypatch):
    """Control: the guards must not block a healthy ingest."""
    csv_path = tmp_path / "cache" / "hmda_north-carolina_2024.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.write_text(
        LAR_HEADER
        + "2024,360,6.5,2,2,2,250000,37183,White,Not Hispanic or Latino,Male\n"
        + "2024,180,5.9,2,2,2,180000,37183,White,Not Hispanic or Latino,Female\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(fh.os.path, "getsize", lambda p: 2_000_000)
    calls = _emit_tripwire(monkeypatch)

    rc = fh.fetch_one("north-carolina", cache_dir=str(csv_path.parent))

    assert rc == 0
    assert len(calls) == 1, "a healthy parse must still emit"


def test_amount_bracket_covers_every_amount():
    """The bucketing table must be a partition of [0, inf).

    This is the CODE half of the >$1M defect. The old table stopped at $5M,
    so `amount_bracket` returned None for larger loans and push_dim silently
    dropped them — 709 rows across the 2024 LAR. The shipped 2024 files still
    carry that shortfall by decision (see the test below); this pins the fix
    so the NEXT annual ingest partitions correctly.
    """
    for dollars in (0, 1, 199_999, 200_000, 999_999, 1_000_000,
                    4_999_999, 5_000_000, 5_000_001, 25_000_000, 1e12):
        assert fh.amount_bracket(float(dollars)) is not None, \
            f"${dollars:,.0f} falls through every loan-amount bracket"
    assert fh.amount_bracket(5_000_001.0) == ">$1M"


def test_shipped_demographics_buckets_sum_to_n_loans(repo_root):
    """Every dimension partitions the same population, so each dimension's
    bucket counts must sum to the state's n_loans.

    `loan_amount` is EXCLUDED for the shipped 2024 files: they were built with
    the old $5M ceiling and are knowingly short by 709 rows nationally
    (0.0003 pp). Re-downloading 3.5M rows a state to correct that is not
    warranted; `test_amount_bracket_covers_every_amount` pins the code fix
    instead. Race / ethnicity / sex must partition exactly, today.
    """
    states_dir = os.path.join(repo_root, "src", "data", "states")
    checked = 0
    problems = []
    for demo_path in sorted(glob.glob(os.path.join(states_dir, "*", "hmda_2024_demographics.json"))):
        slug = os.path.basename(os.path.dirname(demo_path))
        demo = json.load(open(demo_path, encoding="utf-8"))
        for term in (15, 30):
            summary_path = os.path.join(states_dir, slug, f"hmda_2024_{term}yr.json")
            if not os.path.exists(summary_path):
                continue
            n_loans = json.load(open(summary_path, encoding="utf-8")).get("n_loans")
            if not n_loans:
                continue
            for dim, rows in demo.get(f"term_{term}", {}).items():
                if dim == "loan_amount":
                    continue
                total = sum(r.get("n_loans", 0) for r in rows)
                if total == 0:
                    continue  # dimension not populated for this state
                checked += 1
                if total != n_loans:
                    problems.append((slug, term, dim, total, n_loans))
    assert checked > 0, "no demographics files found — the test would be vacuous"
    assert problems == [], f"bucket counts do not partition n_loans: {problems[:10]}"
