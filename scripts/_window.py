"""Shared window definition for the dashboard.

The chart starts at 2024-06 and rolls forward through the current calendar
month. All data scripts use this so chart-ready JSON and the chart's time
scale stay aligned.
"""
import datetime as dt
import json
import os

WINDOW_START_YEAR = 2024
WINDOW_START_MONTH = 6


def window_months(today: dt.date | None = None) -> list[tuple[int, int]]:
    today = today or dt.date.today()
    months: list[tuple[int, int]] = []
    y, m = WINDOW_START_YEAR, WINDOW_START_MONTH
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1
    return months


def window_bounds(today: dt.date | None = None) -> tuple[str, str]:
    months = window_months(today)
    start_y, start_m = months[0]
    end_y, end_m = months[-1]
    # End at first day of month *after* the last window month so the time axis includes it.
    if end_m == 12:
        ny, nm = end_y + 1, 1
    else:
        ny, nm = end_y, end_m + 1
    return f"{start_y:04d}-{start_m:02d}-01", f"{ny:04d}-{nm:02d}-01"


def write_window_json(path: str, today: dt.date | None = None) -> None:
    start, end = window_bounds(today)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"from": start, "to": end, "n_months": len(window_months(today))}, f, indent=2)


if __name__ == "__main__":
    months = window_months()
    start, end = window_bounds()
    print(f"Window: {start} -> {end} ({len(months)} months)")
    print("Months:", ", ".join(f"{y}-{m:02d}" for y, m in months))
