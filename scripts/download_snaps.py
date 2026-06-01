"""Download all planned Wayback snapshots in plan into bankrate_nc_archive2/."""
import json
import os
import urllib.request
import time

with open(r"C:\Users\akanc\Documents\cdx_plan.json", "r") as f:
    plan = json.load(f)["plan"]

out_dir = r"C:\Users\akanc\Documents\bankrate_nc_archive2"
os.makedirs(out_dir, exist_ok=True)

req_headers = {"User-Agent": "Mozilla/5.0 (research)"}
for i, item in enumerate(plan):
    label = f"{item['year']}-{item['month']:02d}"
    fp = os.path.join(out_dir, f"{label}.html")
    if os.path.exists(fp) and os.path.getsize(fp) > 100000:
        print(f"[{i}] {label} cached")
        continue
    try:
        req = urllib.request.Request(item["wb_url"], headers=req_headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            with open(fp, "wb") as f:
                f.write(r.read())
        size = os.path.getsize(fp)
        print(f"[{i}] {label} OK ({size} bytes) {item['snapshot_date']}")
    except Exception as e:
        print(f"[{i}] {label} FAIL: {e}")
    time.sleep(1)  # polite delay between Wayback hits
