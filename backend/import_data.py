"""Join real CoStar / Vexcel / Matterport rows to the OpenStreetMap footprints and write the app's data overlay.

    python backend/import_data.py                      # reads real-data/*.csv
    python backend/import_data.py --in other/folder --out lightwell/data

See real-data/README.md for the CSV columns.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAT0 = 29.7575
M_PER_DEG_LAT = 110540
M_PER_DEG_LON = 111320 * math.cos(math.radians(LAT0))
NEAREST_M = 40


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def num(v, cast=float):
    try:
        return cast(float(v)) if v not in ("", None) else None
    except ValueError:
        return None


def floors(spec: str) -> list[int] | None:
    """'3-7;12;20-22' -> [3, 4, 5, 6, 7, 12, 20, 21, 22]. Empty -> None (unknown, not 'no vacancy')."""
    if not spec:
        return None
    out = set()
    for part in spec.replace(",", ";").split(";"):
        part = part.strip()
        if "-" in part:
            a, b = (int(float(x)) for x in part.split("-", 1)); out.update(range(min(a, b), max(a, b) + 1))
        elif part:
            out.add(int(float(part)))
    return sorted(out)


def point_in_ring(x, y, ring) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def match(rows, features):
    """Return {osm_id: row} plus a report. Point-in-polygon first, then nearest centre within 40 m."""
    cents = []
    for f in features:
        ring = f["geometry"]["coordinates"][0]
        cents.append((f, sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)))
    out, report = {}, []
    for r in rows:
        lat, lon = num(r.get("lat")), num(r.get("lon"))
        if lat is None or lon is None:
            report.append((r.get("costar_id"), "no coordinates", None)); continue
        hit = next((f for f in features if point_in_ring(lon, lat, f["geometry"]["coordinates"][0])), None)
        how = "inside"
        if hit is None:
            best = min(cents, key=lambda c: math.hypot((c[1] - lon) * M_PER_DEG_LON, (c[2] - lat) * M_PER_DEG_LAT))
            d = math.hypot((best[1] - lon) * M_PER_DEG_LON, (best[2] - lat) * M_PER_DEG_LAT)
            if d <= NEAREST_M:
                hit, how = best[0], f"nearest ({d:.0f} m)"
        if hit is None:
            report.append((r.get("costar_id"), "NO MATCH", None)); continue
        oid = hit["properties"]["id"]
        if oid in out:
            report.append((r.get("costar_id"), f"duplicate of {out[oid]['costar_id']}", oid)); continue
        out[oid] = r
        report.append((r.get("costar_id"), how, oid))
    return out, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", default=str(ROOT / "real-data"))
    ap.add_argument("--out", default=str(ROOT / "lightwell" / "data"))
    ap.add_argument("--geo", default=str(ROOT / "lightwell" / "data" / "houston_downtown.geojson"))
    a = ap.parse_args()
    src, out = Path(a.src), Path(a.out)

    features = json.loads(Path(a.geo).read_text(encoding="utf-8"))["features"]
    costar = [r for r in read_csv(src / "costar.csv") if not r.get("property_type") or r["property_type"].lower().startswith("office")]
    parking, interiors = read_csv(src / "parking.csv"), read_csv(src / "interiors.csv")
    if not (costar or parking or interiors):
        sys.exit(f"No rows found in {src}/costar.csv, parking.csv or interiors.csv. See real-data/README.md.")

    by_osm, report = match(costar, features)
    by_cid = {r["costar_id"]: oid for oid, r in by_osm.items()}

    buildings = {}
    for oid, r in by_osm.items():
        buildings[str(oid)] = {k: v for k, v in {
            "costar_id": r["costar_id"], "address": r.get("address") or None, "owner": r.get("owner") or None,
            "leased": None if num(r.get("leased_pct")) is None else num(r.get("leased_pct")) / 100,
            "year": num(r.get("year_built"), int), "rba_sqft": num(r.get("rba_sqft"), int), "floors": num(r.get("floors"), int),
            "vacant_floors": floors(r.get("vacant_floors", "")),
        }.items() if v is not None}

    orphans = []
    for r in parking:
        oid = by_cid.get(r.get("costar_id"))
        spaces, cars = num(r.get("spaces_total")), num(r.get("cars_counted"))
        if oid is None or not spaces:
            orphans.append(("parking", r.get("costar_id"))); continue
        buildings[str(oid)].setdefault("parking", []).append(
            {"date": r.get("capture_date"), "pct": round(min(cars / spaces, 1), 3), "source": r.get("source") or "vexcel"})
    for r in interiors:
        oid = by_cid.get(r.get("costar_id"))
        if oid is None:
            orphans.append(("interiors", r.get("costar_id"))); continue
        core = [num(r.get(k)) for k in ("core_x_ft", "core_y_ft", "core_w_ft", "core_d_ft")]
        buildings[str(oid)]["interior"] = {k: v for k, v in {
            "scanned": r.get("scanned", "").lower() in ("true", "1", "yes"), "W": num(r.get("plate_w_ft")), "D": num(r.get("plate_d_ft")),
            "f2f": num(r.get("floor_to_floor_ft")), "model_id": r.get("matterport_model_id") or None,
            "core": None if None in core else [core[0], core[1], core[0] + core[2], core[1] + core[3]],
        }.items() if v is not None}

    overlay = {"generated": dt.datetime.now().isoformat(timespec="seconds"),
               "counts": {"costar": len(by_osm), "parking": sum(1 for b in buildings.values() if b.get("parking")),
                          "interiors": sum(1 for b in buildings.values() if b.get("interior"))},
               "buildings": buildings}
    out.mkdir(parents=True, exist_ok=True)
    (out / "real_overlay.json").write_text(json.dumps(overlay, indent=1), encoding="utf-8")
    (out / "real_overlay.js").write_text("window.LIGHTWELL_REAL = " + json.dumps(overlay) + ";\n", encoding="utf-8")

    print(f"Matched {len(by_osm)} of {len(costar)} CoStar office rows to OpenStreetMap footprints.")
    for cid, how, oid in report:
        print(f"  {cid:>12}  {how:<18} {'osm ' + str(oid) if oid else ''}")
    for kind, cid in orphans:
        print(f"  {kind} row for {cid}: no matched CoStar building (skipped)")
    print(f"Wrote {out / 'real_overlay.js'}. Reload the page.")


if __name__ == "__main__":
    main()
