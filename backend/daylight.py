"""Daylight X-ray precompute: how much sky each window wall of each tower can see.

For every tall building in lightwell/data/houston_downtown.geojson (OSM height >= 40 m), this script:
  1. fits the same minimum rectangle as minRect() in lightwell/js/data.js, so the four plate walls n / s / e / w match
     the engine's floor plate (W is always the long side, 'n' and 's' are the long walls);
  2. samples points every ~20 ft along each wall and casts a fan of 7 rays (120 degrees) up to 300 ft from each;
  3. along each ray, records every neighbouring footprint it crosses (distance + height);
  4. for heights z = 0, 10, 20 ... ft up to the roof, takes each ray's worst obstruction angle
     atan((neighbour height - z) / distance) and stores the median over all rays of the wall.

Output (both files hold the same data; commit them, they are derived from public OSM data):
  lightwell/data/daylight.json  for Python and tests
  lightwell/data/daylight.js    window.LIGHTWELL_DAYLIGHT, loaded by index.html (works from file://)

Run from the repo root:  python backend/daylight.py
Optional measured heights (e.g. Vexcel):  python backend/daylight.py --heights real-data/heights.csv
  (CSV columns: osm_id,height_m ; those heights are tagged VEXCEL instead of OSM / ESTIMATE)

This is a screening input, not a daylight study: it ignores glazing, reflections, trees and anything not in the
OSM footprints. Buildings without an OSM height are drawn at 8 m and tagged ESTIMATE.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "lightwell" / "data" / "houston_downtown.geojson"
OUT_JSON = ROOT / "lightwell" / "data" / "daylight.json"
OUT_JS = ROOT / "lightwell" / "data" / "daylight.js"

# Same projection as toFt() in lightwell/js/data.js
LAT0, LON0, FT = 29.7575, -95.3665, 3.281
RAYS, FAN_DEG, RANGE_FT, SAMPLE_FT, DZ_FT = 7, 120, 300, 20, 10
MIN_HEIGHT_M = 40          # same height rule as the candidate filter in data.js
PARTY_WALL_FT = 1.0        # distance used when a neighbour touches the wall (shared wall: no window there)


def to_ft(p):
    return ((p[0] - LON0) * math.cos(LAT0 * math.pi / 180) * 111320 * FT, (p[1] - LAT0) * 110540 * FT)


def min_rect(pts):
    """Mirror of minRect() in data.js (1-degree search, strict < tie-break), also returning the angle."""
    best = None
    for a in range(90):
        t = a * math.pi / 180
        c, s = math.cos(t), math.sin(t)
        us = [x * c + y * s for x, y in pts]
        vs = [-x * s + y * c for x, y in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best["area"]:
            best = {"area": w * d, "deg": a, "w": w, "d": d}
    return best


def plate_axes(r):
    """Unit vectors of the plate's x axis (along W, the long side) and y axis (along D), in (east, north) feet.
    The plate is drawn x right / y down, so y = x rotated 90 degrees clockwise. x is chosen to point east-ish,
    which makes 'n' (y = 0) the wall that faces north-ish."""
    t = r["deg"] * math.pi / 180
    eu, ev = (math.cos(t), math.sin(t)), (-math.sin(t), math.cos(t))
    ex = eu if r["w"] >= r["d"] else ev
    if ex[0] < -1e-9 or (abs(ex[0]) <= 1e-9 and ex[1] < 0):
        ex = (-ex[0], -ex[1])
    ey = (ex[1], -ex[0])
    return ex, ey


def point_in(pts, x, y):
    inside = False
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def entry_distance(px, py, dx, dy, poly):
    """Distance along the ray to where it first crosses the polygon outline (None if it doesn't within range)."""
    if point_in(poly["pts"], px, py):
        return PARTY_WALL_FT
    best = None
    pts = poly["pts"]
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((ax - px) * ey - (ay - py) * ex) / den
        s = ((ax - px) * dy - (ay - py) * dx) / den
        if 0 < t <= RANGE_FT and 0 <= s <= 1 and (best is None or t < best):
            best = t
    return best


def compass(nx, ny):
    return round(math.degrees(math.atan2(nx, ny))) % 360


def load(heights_csv: Path | None):
    gj = json.loads(GEOJSON.read_text())
    measured = {}
    if heights_csv:
        with open(heights_csv, newline="") as fh:
            for row in csv.DictReader(fh):
                measured[int(row["osm_id"])] = float(row["height_m"])
    polys = []
    for f in gj["features"]:
        p = f["properties"]
        ring = f["geometry"]["coordinates"][0]
        pts = [to_ft(q) for q in ring]
        if p["id"] in measured:
            h_m, src = measured[p["id"]], "VEXCEL"
        else:
            h_m, src = float(p["height"]), ("ESTIMATE" if p.get("heightSource") == "default" else "OSM")
        xs, ys = [x for x, _ in pts], [y for _, y in pts]
        n = len(ring) - 1
        polys.append({"id": p["id"], "pts": pts, "ring": ring, "h_m": h_m, "h_ft": h_m * FT, "src": src,
                      "bb": (min(xs), min(ys), max(xs), max(ys)), "props": p,
                      "at": [round(sum(q[0] for q in ring[:n]) / n, 6), round(sum(q[1] for q in ring[:n]) / n, 6)]})
    return gj, polys


def walls_for(P, r):
    """The four plate walls in real space: wall -> (start, end, outward normal)."""
    ex, ey = plate_axes(r)
    pu = [x * ex[0] + y * ex[1] for x, y in P["pts"]]
    pv = [x * ey[0] + y * ey[1] for x, y in P["pts"]]
    U0, U1, V0, V1 = min(pu), max(pu), min(pv), max(pv)
    at = lambda u, v: (u * ex[0] + v * ey[0], u * ex[1] + v * ey[1])  # noqa: E731
    return {
        "n": (at(U0, V0), at(U1, V0), (-ey[0], -ey[1])),
        "s": (at(U0, V1), at(U1, V1), ey),
        "w": (at(U0, V0), at(U0, V1), (-ex[0], -ex[1])),
        "e": (at(U1, V0), at(U1, V1), ex),
    }


def analyse(P, polys, data_bb):
    r = min_rect(P["pts"])
    bb = P["bb"]
    near = [Q for Q in polys if Q is not P and Q["bb"][0] < bb[2] + RANGE_FT and Q["bb"][2] > bb[0] - RANGE_FT
            and Q["bb"][1] < bb[3] + RANGE_FT and Q["bb"][3] > bb[1] - RANGE_FT]
    roof = P["h_ft"]
    zs = [i * DZ_FT for i in range(int(roof // DZ_FT) + 1)]
    rec = {"dz": DZ_FT, "face": {}, "prof": {}, "blk": {}, "edge": {}}
    for k, (A, B, nrm) in walls_for(P, r).items():
        length = math.dist(A, B)
        npts = max(2, int(length // SAMPLE_FT) + 1)
        base = math.atan2(nrm[1], nrm[0])
        rays, outside = [], 0
        for i in range(npts):
            t = (i + 0.5) / npts
            px, py = A[0] + (B[0] - A[0]) * t + nrm[0] * 0.6, A[1] + (B[1] - A[1]) * t + nrm[1] * 0.6
            for j in range(RAYS):
                ang = base + math.radians(-FAN_DEG / 2 + FAN_DEG * j / (RAYS - 1))
                dx, dy = math.cos(ang), math.sin(ang)
                hits = []
                for Q in near:
                    d = entry_distance(px, py, dx, dy, Q)
                    if d is not None:
                        hits.append((d, Q))
                rays.append(hits)
                ex_, ey_ = px + dx * RANGE_FT, py + dy * RANGE_FT
                if not (data_bb[0] <= ex_ <= data_bb[2] and data_bb[1] <= ey_ <= data_bb[3]):
                    outside += 1
        prof = []
        for z in zs:
            per_ray = []
            for hits in rays:
                worst = 0.0
                for d, Q in hits:
                    worst = max(worst, math.degrees(math.atan2(Q["h_ft"] - z, d)))
                per_ray.append(worst)
            per_ray.sort()
            prof.append(round(per_ray[(len(per_ray) - 1) // 2], 1))   # lower median: deterministic
        # main blocker at the lowest home floor (~ floor 2): the building that sets most rays' worst angle there
        z2 = min(zs[-1], 20.0)   # always one of the profile heights (multiples of DZ_FT)
        votes = {}
        for hits in rays:
            best, who = 0.0, None
            for d, Q in hits:
                a = math.degrees(math.atan2(Q["h_ft"] - z2, d))
                if a > best:
                    best, who = a, (Q, d)
            if who:
                votes.setdefault(who[0]["id"], []).append(who)
        blk = None
        if votes and prof[zs.index(z2) if z2 in zs else 0] > 0:
            vid = max(votes, key=lambda i: (len(votes[i]), i))
            Q = votes[vid][0][0]
            ds = sorted(w[1] for w in votes[vid])
            blk = {"osm": Q["id"], "d": round(ds[(len(ds) - 1) // 2]), "h": round(Q["h_m"], 1), "src": Q["src"], "at": Q["at"]}
        rec["face"][k] = compass(*nrm)
        rec["prof"][k] = prof
        rec["blk"][k] = blk
        rec["edge"][k] = outside > len(rays) / 2
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--heights", type=Path, help="CSV of measured heights: osm_id,height_m (tagged VEXCEL)")
    args = ap.parse_args()
    gj, polys = load(args.heights)
    data_bb = (min(p["bb"][0] for p in polys), min(p["bb"][1] for p in polys),
               max(p["bb"][2] for p in polys), max(p["bb"][3] for p in polys))
    towers = [P for P in polys if P["src"] != "ESTIMATE" and P["h_m"] >= MIN_HEIGHT_M]
    out = {
        "version": 1,
        "source": GEOJSON.name + " sha1:" + hashlib.sha1(GEOJSON.read_bytes()).hexdigest()[:12],
        "rule": {"rays": RAYS, "fanDeg": FAN_DEG, "rangeFt": RANGE_FT, "sampleFt": SAMPLE_FT, "dzFt": DZ_FT},
        "heights": {s: sum(1 for p in polys if p["src"] == s) for s in ("OSM", "VEXCEL", "ESTIMATE")},
        "buildings": {str(P["id"]): analyse(P, polys, data_bb) for P in towers},
    }
    text = json.dumps(out, separators=(",", ":"), sort_keys=True)
    OUT_JSON.write_text(text + "\n")
    OUT_JS.write_text("// Generated by backend/daylight.py from houston_downtown.geojson. Do not edit by hand.\n"
                      "window.LIGHTWELL_DAYLIGHT = " + text + ";\n")
    print(f"Daylight X-ray: {len(towers)} towers, heights {out['heights']}; wrote {OUT_JSON.name} and {OUT_JS.name}"
          f" ({OUT_JS.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
