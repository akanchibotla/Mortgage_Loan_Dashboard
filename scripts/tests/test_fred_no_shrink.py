"""4.2 — fetch_fred must refuse to shrink the PMMS history.

Tiers 1 and 4 of fetch_series return a single current observation. Before the
guard, main() wrote that unconditionally and collapsed 27 months to 1 with
exit 0 and no FAIL_LOG line — and because Freddie Mac is Tier 1, a lapsed
FRED_API_KEY made that the PERMANENT daily behaviour.
"""
import json
import os
from datetime import datetime

import fetch_fred


def _write_27_months(out_dir: str, term: int) -> str:
    """Lay down a realistic 27-row monthly file, the shipped shape."""
    path = os.path.join(out_dir, f"pmms_{term}yr_monthly.json")
    rows = [{"month": f"2024-{m:02d}", "rate": 6.5, "n_weeks": 4} for m in range(1, 13)]
    rows += [{"month": f"2025-{m:02d}", "rate": 6.6, "n_weeks": 4} for m in range(1, 13)]
    rows += [{"month": f"2026-{m:02d}", "rate": 6.7, "n_weeks": 4} for m in range(1, 4)]
    assert len(rows) == 27
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    return path


def test_single_row_fallback_keeps_previous_json(tmp_path, monkeypatch):
    out_dir = str(tmp_path)
    monkeypatch.setattr(fetch_fred, "OUT_DIR", out_dir)
    paths = {t: _write_27_months(out_dir, t) for t in (15, 30)}
    before = {t: open(p, encoding="utf-8").read() for t, p in paths.items()}

    fail_log = tmp_path / "fail.log"
    monkeypatch.setattr(fetch_fred, "FAIL_LOG", str(fail_log))

    # Every series degrades to the single-row fallback.
    monkeypatch.setattr(
        fetch_fred, "fetch_series",
        lambda fred_id: [(datetime(2026, 4, 2), 6.75)],
    )

    rc = fetch_fred.main()

    assert rc == 0, "the guard must not break the workflow — it reports, it does not fail"
    for t, p in paths.items():
        assert len(json.load(open(p, encoding="utf-8"))) == 27, f"{t}-yr history was truncated"
        assert open(p, encoding="utf-8").read() == before[t], f"{t}-yr file was rewritten"

    logged = fail_log.read_text(encoding="utf-8")
    for fred_id in fetch_fred.SERIES.values():
        assert f"fred:{fred_id} (single-row fallback; kept previous JSON)" in logged


def test_full_history_still_writes(tmp_path, monkeypatch):
    """The guard must not block a healthy multi-row fetch."""
    out_dir = str(tmp_path)
    monkeypatch.setattr(fetch_fred, "OUT_DIR", out_dir)
    paths = {t: _write_27_months(out_dir, t) for t in (15, 30)}
    monkeypatch.setattr(fetch_fred, "FAIL_LOG", None)

    # Two observations inside the window, one month apart.
    y, m = fetch_fred.window_months()[-1]
    monkeypatch.setattr(
        fetch_fred, "fetch_series",
        lambda fred_id: [(datetime(y, m, 5), 6.70), (datetime(y, m, 12), 6.80)],
    )

    assert fetch_fred.main() == 0
    for p in paths.values():
        rows = json.load(open(p, encoding="utf-8"))
        assert len(rows) == 1 and rows[0]["n_weeks"] == 2, "a real fetch must still overwrite"


def test_first_ever_run_is_not_blocked(tmp_path, monkeypatch):
    """No file on disk => nothing to protect => the single row must be written."""
    monkeypatch.setattr(fetch_fred, "OUT_DIR", str(tmp_path))
    monkeypatch.setattr(fetch_fred, "FAIL_LOG", None)
    y, m = fetch_fred.window_months()[-1]
    monkeypatch.setattr(
        fetch_fred, "fetch_series", lambda fred_id: [(datetime(y, m, 5), 6.70)]
    )

    assert fetch_fred.main() == 0
    assert os.path.exists(tmp_path / "pmms_30yr_monthly.json")
