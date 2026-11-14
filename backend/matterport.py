"""Measure floor plates from CoStar's Matterport scans with the Matterport Model API; write real-data/interiors.csv.

    python backend/matterport.py --dry-run          # print what each scan measures; writes nothing
    python backend/matterport.py                    # write real-data/interiors.csv
    python backend/import_data.py                   # then rebuild the overlay and reload the page

Needs MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in the project's .env: the "API key" and "API token" on the CoStar
Discord card "Matterport GraphQL + SDK" (Matterport calls them the API Token ID and Token Secret; they are sent as
HTTP Basic auth to https://api.matterport.com/api/models/graph, or MATTERPORT_API_URL if set). The model ids come
from real-data/costar.csv, written by backend/costar_kit.py.

Many CoStar scans show one suite or the lobby, not a whole floor. A scan counts as a measured floor plate only when
one of its floors covers at least 80% of the typical floor CoStar records; then the plate width and depth come from
that floor (tagged MATTERPORT in the app). Other scans are listed with what they cover, and the plate stays the
OpenStreetMap footprint. Ceiling heights from a scan are not slab-to-slab heights, so floor-to-floor is left empty.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import env  # noqa: F401  (loads MATTERPORT_API_KEY / MATTERPORT_API_TOKEN from the project's .env)

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("MATTERPORT_API_URL", "https://api.matterport.com/api/models/graph")
FULL_FLOOR = 0.8
# From Matterport's Model API samples ("Get all Dimensional Data from the Model, Floors and Rooms").
QUERY = """query getDimensions($modelId: ID!) {
  model(id: $modelId) {
    name
    floors { label dimensions(units: imperial) { areaFloor width depth height units } }
  }
}"""
COLUMNS = ["costar_id", "scanned", "plate_w_ft", "plate_d_ft", "floor_to_floor_ft", "core_x_ft", "core_y_ft", "core_w_ft",
           "core_d_ft", "matterport_model_id", "notes"]


class MatterportError(Exception):
    pass


def fetch(model_id: str, key: str, token: str) -> dict:
    body = json.dumps({"query": QUERY, "variables": {"modelId": model_id}}).encode()
    auth = base64.b64encode(f"{key}:{token}".encode()).decode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise MatterportError(f"HTTP {e.code}: the Matterport key or token was rejected (check MATTERPORT_API_KEY and "
                                  "MATTERPORT_API_TOKEN in .env)") from None
        raise MatterportError(f"HTTP {e.code} from the Matterport API") from None
    except urllib.error.URLError as e:
        raise MatterportError(f"could not reach the Matterport API ({e.reason})") from None
    if out.get("errors"):
        codes = {((x.get("extensions") or {}).get("code") or "error") for x in out["errors"]}
        msg = "; ".join(x.get("message", "") for x in out["errors"])[:200]
        if codes & {"request.unauthenticated", "request.unauthorized"}:
            raise MatterportError(f"not allowed ({', '.join(sorted(codes))}): this token can't read the model. {msg}")
        if not (out.get("data") or {}).get("model"):
            raise MatterportError(f"{', '.join(sorted(codes))}: {msg}")
    return (out.get("data") or {}).get("model") or {}


def best_floor(model: dict):
    """The scan's largest floor: (label, width ft, depth ft, area sq ft, height ft)."""
    best = None
    for f in model.get("floors") or []:
        d = f.get("dimensions") or {}
        area = d.get("areaFloor") or ((d.get("width") or 0) * (d.get("depth") or 0))
        if area and (best is None or area > best[3]):
            best = (f.get("label") or "?", d.get("width"), d.get("depth"), area, d.get("height"))
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--costar", type=Path, default=ROOT / "real-data" / "costar.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "real-data" / "interiors.csv")
    ap.add_argument("--max-models", type=int, default=4, help="scans to read per building (each one is an API call)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    key, token = os.environ.get("MATTERPORT_API_KEY"), os.environ.get("MATTERPORT_API_TOKEN")
    if not (key and token):
        sys.exit("Set MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in the project's .env file (see .env.example): the "
                 "\"API key\" and \"API token\" from the CoStar Discord card \"Matterport GraphQL + SDK\".")
    if not a.costar.exists():
        sys.exit(f"{a.costar} not found: run python backend/costar_kit.py first.")
    with a.costar.open(newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("matterport_models")]
    out, failures = [], 0
    for r in rows:
        typical = float(r.get("typical_floor_sqft") or 0)
        name = r.get("building_name") or r.get("address")
        best = None   # (area, model id, floor tuple)
        for mid in r["matterport_models"].split(";")[:a.max_models]:
            try:
                m = fetch(mid, key, token)
            except MatterportError as e:
                failures += 1
                print(f"  {name}: scan {mid}: {e}")
                if "rejected" in str(e):
                    sys.exit("Stopping: fix the Matterport credentials first.")
                continue
            f = best_floor(m)
            print(f"  {name}: scan {mid} '{m.get('name') or ''}': "
                  + (f"largest floor '{f[0]}' {f[1] or 0:.0f} x {f[2] or 0:.0f} ft, {f[3]:,.0f} sq ft" + (f", ceiling ~{f[4]:.1f} ft" if f[4] else "") if f else "no floor dimensions"))
            if f and (best is None or f[3] > best[0]):
                best = (f[3], mid, f)
        if not best:
            continue
        area, mid, f = best
        full = typical and area >= FULL_FLOOR * typical and f[1] and f[2]
        cover = f"{area:,.0f} of the {typical:,.0f} sq ft typical floor" if typical else f"{area:,.0f} sq ft"
        if full:
            out.append({"costar_id": r["costar_id"], "scanned": "true", "plate_w_ft": round(max(f[1], f[2])), "plate_d_ft": round(min(f[1], f[2])),
                        "floor_to_floor_ft": "", "core_x_ft": "", "core_y_ft": "", "core_w_ft": "", "core_d_ft": "",
                        "matterport_model_id": mid, "notes": f"Matterport scan {mid}, floor '{f[0]}': covers {cover}"})
            print(f"  -> {name}: measured plate {round(max(f[1], f[2]))} x {round(min(f[1], f[2]))} ft (scan covers {cover})")
        else:
            print(f"  -> {name}: no full-floor scan (best covers {cover}); the plate stays the map footprint")
    print(f"{len(out)} buildings with a measured floor plate; {failures} scans could not be read.")
    if a.dry_run or not out:
        return
    a.out.parent.mkdir(parents=True, exist_ok=True)
    with a.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)
    print(f"Wrote {a.out}. Next: python backend/import_data.py")


if __name__ == "__main__":
    main()
