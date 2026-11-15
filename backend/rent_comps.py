"""Rent comparables for the rent check: real asking rents near downtown Houston from the CoStar data kit.

    python backend/rent_comps.py --show            # list the kit files and the columns found; writes nothing
    python backend/rent_comps.py                   # -> real-data/rents.csv, then run backend/import_data.py
    python backend/rent_comps.py --map rent=AskingRent,beds=Beds   # if a column was not recognised

Reads, from $COSTAR_KIT_DIR (or ../costar-hackathon-kit):
  - every residential listing file in the kit (*residential*listing*.csv / .jsonl), keeping rentals only
  - multifamily properties (propertyType 11) in data/commercial-property.jsonl, when they carry an asking rent
Keeps listings within RADIUS_M of downtown with a sane monthly rent, and writes one row per listing:
  lat, lon, beds, rent_month, sqft, source, ref
The kit's column names are recognised by pattern (latitude / longitude / rent / bedrooms / square feet); --show prints
what was matched so nothing is guessed silently. Nothing is invented: a listing without a rent is dropped.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from pathlib import Path

import env  # noqa: F401  (COSTAR_KIT_DIR can be set in the project's .env)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "real-data" / "rents.csv"
LAT0, LON0, RADIUS_M = 29.7575, -95.3665, 4000
MULTIFAMILY = 11
RENT_MIN, RENT_MAX, SQFT_MIN, SQFT_MAX = 400, 15000, 250, 4000

# column patterns, checked against lower-case names with non-letters removed ("Asking Rent ($)" -> "askingrent")
PAT = {
    "lat": [r"^lat(itude)?$", r"latitude$"],
    "lon": [r"^(lon|lng|long)(itude)?$", r"longitude$"],
    "rent": [r"(asking|list|monthly|current|average|avg)?rent(amount|price|permonth|monthly)?(perunit)?$", r"rent(perunit|unit)$", r"^(listprice|price)$"],
    "beds": [r"^(num)?bed(room)?s?(count)?$", r"bedrooms?$", r"^beds?$"],
    "sqft": [r"(living|unit|total|rentable)?(area|size)?(sqft|squarefeet|squarefootage)$", r"^(livingarea|unitsize|sqft)$"],
    "kind": [r"(listing|transaction|offer|sale)(type|status)$", r"^(forrent|forsale|status|type)$"],
}


def norm(k: str) -> str:
    return re.sub(r"[^a-z]", "", k.lower())


def flat(d, pre=""):
    out = {}
    for k, v in (d or {}).items():
        key = f"{pre}.{k}" if pre else k
        if isinstance(v, dict):
            out.update(flat(v, key))
        elif not isinstance(v, list):
            out[key] = v
    return out


def detect(keys, override):
    found = {}
    for field, pats in PAT.items():
        if field in override:
            found[field] = override[field] if override[field] in keys else None
            continue
        for p in pats:   # first pattern wins; within a pattern prefer the shortest (least nested) key
            hits = sorted((k for k in keys if re.search(p, norm(k.split(".")[-1]))), key=len)
            if hits:
                found[field] = hits[0]
                break
    return found


def num(v):
    try:
        return float(str(v).replace("$", "").replace(",", "").strip()) if v not in (None, "") else None
    except ValueError:
        return None


def dist_m(lat, lon):
    return math.hypot((lon - LON0) * 111320 * math.cos(math.radians(LAT0)), (lat - LAT0) * 110540)


def rows_of(path: Path):
    if path.suffix == ".jsonl":
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    yield flat(json.loads(line))
    else:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            yield from csv.DictReader(fh)


def is_rental(r, col):
    if not col.get("kind"):
        return True
    v = str(r.get(col["kind"]) or "").lower()
    return not v or "rent" in v or "lease" in v or v in ("2",)   # sale listings are dropped


def read_listings(path: Path, override, show):
    it = rows_of(path)
    first = next(it, None)
    if first is None:
        return [], {}
    col = detect(list(first.keys()), override)
    if show:
        print(f"\n{path.name}: {len(first)} columns")
        for f in PAT:
            print(f"  {f:<5} <- {col.get(f) or '(not found)'}")
        print("  first row:", json.dumps({k: first[k] for k in list(first)[:14]}, default=str)[:600])
    if not (col.get("lat") and col.get("lon") and col.get("rent")):
        return [], col
    out = []
    for r in [first, *it]:
        lat, lon, rent = num(r.get(col["lat"])), num(r.get(col["lon"])), num(r.get(col["rent"]))
        if lat is None or lon is None or rent is None or not is_rental(r, col):
            continue
        if not (RENT_MIN <= rent <= RENT_MAX) or dist_m(lat, lon) > RADIUS_M:
            continue
        beds, sqft = num(r.get(col.get("beds"))), num(r.get(col.get("sqft")))
        out.append({"lat": round(lat, 6), "lon": round(lon, 6), "beds": None if beds is None else int(min(beds, 4)),
                    "rent_month": round(rent), "sqft": round(sqft) if sqft and SQFT_MIN <= sqft <= SQFT_MAX else None,
                    "source": f"CoStar kit: {path.name}", "ref": r.get("id") or r.get("listingId") or r.get("ListingId") or ""})
    return out, col


def read_multifamily(kit: Path, override, show):
    """Multifamily properties in the commercial records, when they carry an asking rent per unit."""
    p = kit / "data" / "commercial-property.jsonl"
    if not p.exists():
        return []
    out, col, n = [], None, 0
    with open(p, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("propertyType") != MULTIFAMILY:
                continue
            f = flat(r)
            if col is None:
                col = detect([k for k in f if k.startswith(("propertyApartment", "primaryAddress"))], override)
                if show:
                    print(f"\ncommercial-property.jsonl (multifamily): rent <- {col.get('rent') or '(not found)'}, "
                          f"lat <- {col.get('lat')}, sqft <- {col.get('sqft')}")
                    print("  apartment fields:", ", ".join(k for k in f if k.startswith("propertyApartment"))[:900])
            n += 1
            lat, lon, rent = num(f.get(col.get("lat"))), num(f.get(col.get("lon"))), num(f.get(col.get("rent")))
            if None in (lat, lon, rent) or not (RENT_MIN <= rent <= RENT_MAX) or dist_m(lat, lon) > RADIUS_M:
                continue
            sqft = num(f.get(col.get("sqft")))
            out.append({"lat": round(lat, 6), "lon": round(lon, 6), "beds": None, "rent_month": round(rent),
                        "sqft": round(sqft) if sqft and SQFT_MIN <= sqft <= SQFT_MAX else None,
                        "source": "CoStar kit: multifamily property (average asking rent per unit)", "ref": r.get("id", "")})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kit", default=os.environ.get("COSTAR_KIT_DIR") or str(ROOT.parent / "costar-hackathon-kit"))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--show", action="store_true", help="print the files and the columns found; write nothing")
    ap.add_argument("--map", default="", help="override a column, e.g. rent=AskingRent,beds=Bedrooms")
    a = ap.parse_args()
    kit = Path(a.kit)
    if not kit.exists():
        sys.exit(f"CoStar kit not found at {kit}. Pass --kit /path/to/costar-hackathon-kit or set COSTAR_KIT_DIR in .env.")
    override = dict(x.split("=", 1) for x in a.map.split(",") if "=" in x)
    files = sorted(p for p in kit.rglob("*") if p.suffix in (".csv", ".jsonl") and re.search(r"residential|rental|apartment", p.name, re.I))
    if a.show:
        print("Residential / rental files in the kit:", ", ".join(str(p.relative_to(kit)) for p in files) or "none")
    rows = []
    for p in files:
        got, _ = read_listings(p, override, a.show)
        rows += got
        if not a.show:
            print(f"  {p.name}: {len(got)} rentals within {RADIUS_M / 1000:g} km of downtown")
    mf = read_multifamily(kit, override, a.show)
    rows += mf
    if not a.show:
        print(f"  multifamily properties with an asking rent: {len(mf)}")
    if a.show:
        print(f"\nWould write {len(rows)} rent comparables. Run without --show to write {a.out}.")
        return
    if not rows:
        sys.exit("No rents found. Run with --show to see the kit's columns, then pass --map rent=<column>.")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["lat", "lon", "beds", "rent_month", "sqft", "source", "ref"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} rent comparables to {out}. Next: python backend/import_data.py")


if __name__ == "__main__":
    main()
