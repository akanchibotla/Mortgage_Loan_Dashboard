"""Shared JSONL accumulator I/O for the four daily fetchers.

WHY THIS MODULE EXISTS
  fetch_bankrate_state, fetch_mnd_state, fetch_nerdwallet_state and
  fetch_rocket each carried a near-identical `write_jsonl_idempotent`, and all
  four shared the same two defects:

    1. NOT ATOMIC. The rewrite is `open(path, "w")` — which truncates the file
       to zero bytes — followed by a loop that re-serialises every historical
       row. An exception, a cancelled CI job or a full disk between those two
       moments leaves the accumulator truncated or half-written. These files
       ARE the archive: nothing upstream can rebuild them.

    2. SILENTLY DELETES MALFORMED LINES. `except json.JSONDecodeError: pass`
       drops the offending line and the very next write re-serialises the file
       WITHOUT it, so a single corrupt byte permanently deletes a day of
       history with no log line anywhere.

  Consolidating them is what lets one fix cover all four; it is not a
  refactor for its own sake.
"""
from __future__ import annotations

import json
import os
import sys


def read_jsonl(path: str) -> list[dict]:
    """Parse a JSONL file, REPORTING malformed lines instead of eating them.

    A malformed line is still skipped — there is nothing else to do with it —
    but the path and line number reach stderr, so the loss is visible in the
    refresh log rather than silent.
    """
    rows: list[dict] = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(
                    f"  WARNING: {path}:{lineno}: malformed JSON, line dropped "
                    f"from the rewrite: {e}",
                    file=sys.stderr,
                )
    return rows


def write_jsonl_atomic(path: str, rows: list[dict]) -> None:
    """Serialise `rows` to `path` via a temp file + os.replace().

    os.replace() is atomic on both POSIX and Windows for same-directory paths,
    so a reader (or a crash) sees either the whole old file or the whole new
    one — never a truncated middle. The temp file is written in the SAME
    directory on purpose: os.replace across filesystems is not atomic.
    """
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        # Leave the original untouched and clean up the partial temp file.
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
        raise


def upsert_jsonl(path: str, new_row: dict, key: str = "date_iso") -> None:
    """Insert-or-replace `new_row` by `key`, then rewrite the file atomically.

    Rows missing `key` are preserved (sorted last) rather than dropped — three
    of the four original copies silently discarded them.
    """
    existing = read_jsonl(path)
    keyed: dict[str, dict] = {}
    unkeyed: list[dict] = []
    for r in existing:
        k = r.get(key)
        if k:
            keyed[k] = r
        else:
            unkeyed.append(r)
    keyed[new_row[key]] = new_row
    rows = sorted(keyed.values(), key=lambda r: r.get(key, "")) + unkeyed
    write_jsonl_atomic(path, rows)
