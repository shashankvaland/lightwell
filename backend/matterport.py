"""Measure CoStar's Matterport scans with the Matterport Model API; write real-data/interiors.csv.

    python backend/matterport.py --dry-run          # print what each scan measures; writes nothing
    python backend/matterport.py                    # write real-data/interiors.csv
    python backend/import_data.py                   # then rebuild the overlay and reload the page

Needs MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in the project's .env: the "API key" and "API token" on the CoStar
Discord card "Matterport GraphQL + SDK" (Matterport calls them the API Token ID and Token Secret; they are sent as
HTTP Basic auth to https://api.matterport.com/api/models/graph, or MATTERPORT_API_URL if set). The model ids come
from real-data/costar.csv, written by backend/costar_kit.py.

What a scan gives, and how Lightwell uses it:
- Clear ceiling height: the area-weighted middle of the room heights (or volume / floor area). Only scans of office
  space count (a suite, a floor, a coworking space); lobbies, tunnels, gyms and unnamed spaces are listed, not used.
  The building's value is the middle office ceiling by scanned area, and only when at least 2,000 sq ft of office
  space was scanned (one small room is not enough). The engine's height test uses it (tagged MATTERPORT) while
  floor-to-floor is only an estimate. A ceiling height is not a slab-to-slab height, so floor_to_floor_ft stays
  empty: the slab is at least `slabFt` above the ceiling, never less.
- Floor area and extent of the scan: shown as evidence next to CoStar's typical floor and the map footprint. The
  API gives no plate width and depth for these scans, so the plate stays the OpenStreetMap footprint.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import env  # noqa: F401  (loads MATTERPORT_API_KEY / MATTERPORT_API_TOKEN from the project's .env)

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("MATTERPORT_API_URL", "https://api.matterport.com/api/models/graph")
FULL_FLOOR = 0.8
M_TO_FT = 3.28084
# After Matterport's Model API sample "Get all Dimensional Data from the Model, Floors and Rooms", plus scan positions.
QUERY = """query getDimensions($modelId: ID!) {
  model(id: $modelId) {
    name
    dimensions(units: imperial) { areaFloor volume }
    floors { label dimensions(units: imperial) { areaFloor width depth height } }
    rooms { dimensions(units: imperial) { areaFloor height } }
    panoLocations { position { x y z } }
  }
}"""
COLUMNS = ["costar_id", "scanned", "plate_w_ft", "plate_d_ft", "floor_to_floor_ft", "core_x_ft", "core_y_ft", "core_w_ft",
           "core_d_ft", "matterport_model_id", "notes", "ceiling_ft", "ceiling_min_ft", "ceiling_max_ft", "scan_area_sqft", "scan_extent_ft",
           "scan_name", "scans_measured"]
# A scan is office space only when its name says so; amenity and unnamed scans never set a ceiling height.
AMENITY = re.compile(r"lobby|tunnel|fitness|gym|concourse|mezzanine|skywalk|lounge|conference|training|cafe|garage|parking|roof|terrace|entrance|amenit", re.I)
OFFICE = re.compile(r"suite|\bste\b|floor|level|office|co-?working|industrious|servcorp|regus|wework|\b\d{3,4}\b", re.I)
CEIL_RANGE = (7.0, 16.0)   # plausible clear ceiling of an office floor, ft
MIN_OFFICE_SQFT = 2000     # office space that must be scanned before a ceiling height counts


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


def weighted_median(pairs):
    """Middle value of (value, weight) pairs by weight."""
    pairs = sorted((v, w) for v, w in pairs if v is not None and w and w > 0)
    half, run = sum(w for _, w in pairs) / 2, 0.0
    for v, w in pairs:
        run += w
        if run >= half:
            return v
    return None


def extent_ft(model: dict):
    """Smallest rectangle around the scan positions (ft), or None: how far the scan reaches, not the wall-to-wall plate."""
    pts = [(p["position"]["x"] * M_TO_FT, p["position"]["y"] * M_TO_FT) for p in model.get("panoLocations") or []
           if (p.get("position") or {}).get("x") is not None]
    if len(pts) < 8:
        return None
    best = None
    for deg in range(0, 90):
        c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        us, vs = [x * c + y * s_ for x, y in pts], [-x * s_ + y * c for x, y in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best[0] * best[1]:
            best = (w, d)
    return (round(max(best)), round(min(best)))


def measure(model: dict) -> dict:
    """One scan: name, kind (office / amenity / unclear), floor area (sq ft), clear ceiling (ft), extent (ft)."""
    name = (model.get("name") or "").strip()
    dims = model.get("dimensions") or {}
    area = dims.get("areaFloor") or sum(((f.get("dimensions") or {}).get("areaFloor") or 0) for f in model.get("floors") or [])
    rooms = [(r.get("dimensions") or {}) for r in model.get("rooms") or []]
    rated = [(d.get("height"), d.get("areaFloor")) for d in rooms if d.get("height") and (d.get("areaFloor") or 0) >= 40]
    ceil = weighted_median(rated) if sum(w for _, w in rated) >= 0.5 * (area or 1) else None
    if ceil is None and area and dims.get("volume"):
        ceil = dims["volume"] / area
    if ceil is not None and not CEIL_RANGE[0] <= ceil <= CEIL_RANGE[1]:
        ceil = None
    kind = "amenity" if AMENITY.search(name) else "office" if OFFICE.search(name) else "unclear"
    return {"name": name, "kind": kind, "area": area or 0, "ceil": round(ceil, 1) if ceil else None, "extent": extent_ft(model)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--costar", type=Path, default=ROOT / "real-data" / "costar.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "real-data" / "interiors.csv")
    ap.add_argument("--max-models", type=int, default=12, help="scans to read per building (each one is an API call)")
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
        scans = []
        for mid in r["matterport_models"].split(";")[:a.max_models]:
            try:
                m = measure(fetch(mid, key, token))
            except MatterportError as e:
                failures += 1
                print(f"  {name}: scan {mid}: {e}")
                if "rejected" in str(e):
                    sys.exit("Stopping: fix the Matterport credentials first.")
                continue
            m["id"] = mid
            scans.append(m)
            print(f"  {name}: scan {mid} '{m['name']}' [{m['kind']}]: {m['area']:,.0f} sq ft"
                  + (f", ceiling {m['ceil']} ft" if m["ceil"] else ", no ceiling height")
                  + (f", extent {m['extent'][0]} x {m['extent'][1]} ft" if m["extent"] else ""))
        used = [m for m in scans if m["kind"] == "office" and m["ceil"]]
        if not used:
            print(f"  -> {name}: no office-space scan with a ceiling height; nothing measured")
            continue
        seen = sum(m["area"] for m in used)
        if seen < MIN_OFFICE_SQFT:
            print(f"  -> {name}: only {seen:,.0f} sq ft of office space scanned (needs {MIN_OFFICE_SQFT:,}); nothing measured")
            continue
        big = max(used, key=lambda m: m["area"])
        lo, hi = min(m["ceil"] for m in used), max(m["ceil"] for m in used)
        mid_c = weighted_median([(m["ceil"], m["area"]) for m in used])
        full = bool(typical and big["area"] >= FULL_FLOOR * typical)
        cover = f"{big['area']:,.0f} of the {typical:,.0f} sq ft typical floor" if typical else f"{big['area']:,.0f} sq ft"
        out.append({"costar_id": r["costar_id"], "scanned": "true", "plate_w_ft": "", "plate_d_ft": "", "floor_to_floor_ft": "",
                    "core_x_ft": "", "core_y_ft": "", "core_w_ft": "", "core_d_ft": "", "matterport_model_id": big["id"],
                    "notes": f"{len(used)} office scan{'s' if len(used) != 1 else ''}, {seen:,.0f} sq ft in all. Largest: '{big['name']}', {cover}"
                             + (" (a whole floor)" if full else " (part of a floor)"),
                    "ceiling_ft": mid_c, "ceiling_min_ft": lo, "ceiling_max_ft": hi, "scan_area_sqft": round(big["area"]),
                    "scan_extent_ft": f"{big['extent'][0]}x{big['extent'][1]}" if big["extent"] else "",
                    "scan_name": big["name"], "scans_measured": len(used)})
        print(f"  -> {name}: clear ceiling {mid_c} ft" + (f" (range {lo} to {hi} ft)" if hi != lo else "") + f" from {len(used)} office scan{'s' if len(used) != 1 else ''}; "
              f"largest covers {cover}")
    print(f"{len(out)} buildings with a measured ceiling height; {failures} scans could not be read.")
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
