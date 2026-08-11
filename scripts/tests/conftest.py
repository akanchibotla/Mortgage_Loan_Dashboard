"""Shared fixtures for the pipeline unit tests.

The pipeline scripts are flat modules that `sys.path.insert` their own
directory and import siblings by bare name (`from _paths import ...`). Doing
the same here is what lets the tests import them at all — pytest's rootdir
insertion puts the repo root on the path, not `scripts/`.
"""
import os
import sys

import pytest

SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)


@pytest.fixture
def repo_root() -> str:
    """Absolute path to the checkout. Tests that read SHIPPED data (the
    regression pins in 4.1/4.6/4.7) use this; tests that WRITE use tmp_path."""
    return REPO_ROOT


@pytest.fixture
def jsonl_file(tmp_path):
    """Factory: write rows (dicts) as a .jsonl file under tmp_path and return
    its path. Keeps every write-path test off the real data/daily tree."""
    import json

    def _make(name: str, rows: list[dict]) -> str:
        p = tmp_path / name
        with open(p, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        return str(p)

    return _make
