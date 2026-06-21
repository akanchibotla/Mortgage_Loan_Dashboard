"""Centralized paths relative to the repo root, with per-state helpers."""
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(REPO_ROOT, "src", "data")
STATES_DIR = os.path.join(DATA_DIR, "states")
DAILY_DIR = os.path.join(REPO_ROOT, "data", "daily")

WINDOW_JSON = os.path.join(DATA_DIR, "window.json")
STATES_INDEX_JSON = os.path.join(DATA_DIR, "states_index.json")


def state_data_dir(slug: str) -> str:
    return os.path.join(STATES_DIR, slug)


def bankrate_jsonl(slug: str) -> str:
    return os.path.join(DAILY_DIR, f"bankrate_{slug}.jsonl")


def mnd_jsonl(slug: str) -> str:
    return os.path.join(DAILY_DIR, f"mnd_{slug}.jsonl")


def mnd_today_view(slug: str) -> str:
    return os.path.join(state_data_dir(slug), "mnd_today.json")


def nerdwallet_jsonl(slug: str) -> str:
    return os.path.join(DAILY_DIR, f"nerdwallet_{slug}.jsonl")


def nerdwallet_today_view(slug: str) -> str:
    return os.path.join(state_data_dir(slug), "nerdwallet_today.json")


# Rocket Mortgage is the only currently-tracked source that publishes a single
# national rate rather than per-state. Its files therefore live at the top of
# DATA_DIR / DAILY_DIR alongside the FRED-PMMS national series, with no slug.
def rocket_jsonl() -> str:
    return os.path.join(DAILY_DIR, "rocket.jsonl")


def rocket_today_view() -> str:
    return os.path.join(DATA_DIR, "rocket_today.json")


def rocket_monthly(term: int) -> str:
    return os.path.join(DATA_DIR, f"rocket_{term}yr_monthly.json")


def rocket_daily(term: int) -> str:
    return os.path.join(DATA_DIR, f"rocket_{term}yr_daily.json")


# Raw inputs that live outside the repo (only used by one-shot ingest scripts
# that aren't part of the CI refresh pipeline).
RAW_PMMS_XLSX = r"C:\Users\akanc\Documents\freddie_pmms.xlsx"
RAW_HMDA_CSV = r"C:\Users\akanc\Documents\hmda_nc_2024_home_purchase.csv"
RAW_BANKRATE_ARCHIVE2 = r"C:\Users\akanc\Documents\bankrate_nc_archive2"
