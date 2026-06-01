"""Centralized path constants relative to the repo root.

Scripts that run both locally (Windows) and in CI (Linux) should import from
here rather than hardcoding absolute paths.
"""
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(REPO_ROOT, "src", "data")
DAILY_DIR = os.path.join(REPO_ROOT, "data", "daily")

BANKRATE_JSONL = os.path.join(DAILY_DIR, "bankrate_nc.jsonl")
MND_JSONL = os.path.join(DAILY_DIR, "mnd_nc.jsonl")

WINDOW_JSON = os.path.join(DATA_DIR, "window.json")
MND_TODAY_VIEW = os.path.join(DATA_DIR, "mnd_nc_today.json")

# Raw inputs that live outside the repo (only used by one-shot ingest scripts
# that aren't part of the CI refresh pipeline).
RAW_PMMS_XLSX = r"C:\Users\akanc\Documents\freddie_pmms.xlsx"
RAW_HMDA_CSV = r"C:\Users\akanc\Documents\hmda_nc_2024_home_purchase.csv"
RAW_BANKRATE_ARCHIVE2 = r"C:\Users\akanc\Documents\bankrate_nc_archive2"
