"""Turn the CoStar hackathon data kit into Lightwell's real-data CSVs for the downtown Houston office towers.

    python backend/costar_kit.py                 # kit from $COSTAR_KIT_DIR, else ../costar-hackathon-kit
    python backend/costar_kit.py --kit /path/to/costar-hackathon-kit
    python backend/import_data.py                # then build the app's overlay and reload the page

Writes (git-ignored: CoStar data is licensed to the team):
  real-data/costar.csv    one row per office tower: the CoStar record plus the map footprint it belongs to
  real-data/tenants.csv   one row per current tenancy: tenant, floors, square feet, lease end when on record

How each value is made (real-data/README.md has the column list):
  - Towers: Office properties (propertyType 5) in the Houston research market (14) inside the map, 6+ storeys.
  - Footprint: street address and name first, then the point inside a footprint, then height and size. Each map
    footprint is used once. OpenStreetMap often holds the wrong height for a tower (or none): when its height does
    not fit the storey count, CoStar's height (or storeys x 13 ft, an estimate) replaces it.
  - Percent leased = 100% - vacant direct space on the market now / RBA (CoStar's formula; vacant space = direct
    listing spaces available now). A tower with no listing and no tenant uses the share leased at its latest sale.
  - Empty floors: floors whose vacant direct space covers 80%+ of the typical floor (or a full-floor space), or
    every office floor when the tower is reported empty.
  - Floor-to-floor: CoStar's slab-to-slab height when it agrees with the building's height (within 2.5 ft a
    storey); otherwise the estimate stays and the conflict is written to f2f_note.
  - Sprinklers, year built and renovated, class and rating, parking spaces, photo and Matterport model ids as
    CoStar records them. A building CoStar marks as converted carries converted_year (it never passes the brief).
  - Tenants: current tenancies (no end date) on known office floors; names from company-detail; the lease end
    only when the lease deal has a future expiration date (blank = not on record).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

import env  # noqa: F401  (COSTAR_KIT_DIR can be set in the project's .env)

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "lightwell" / "data" / "houston_downtown.geojson"
OUT = ROOT / "real-data"

OFFICE, MULTIFAMILY, HOUSTON = 5, 11, 14
DIRECT_LISTINGS = {14, 16, 28}        # property / building-park / disconnected direct space for lease
DIRECT_SPACES = {0, 1, 2}             # unknown, relet, new (sublet and assignment space is available, not vacant)
FULL_FLOOR = 0.8                      # vacant share of the typical floor that makes a floor "empty"
EVENT_COMPLETE, EVENT_RENOVATED, EVENT_CONVERTED = 2, 4, 7
STATUS_CONVERTED = 6
CLASS = {1: "A", 2: "B", 3: "C", 4: "F"}
LEASE_TYPE = {0: "", 1: "Direct", 2: "Sublease", 3: "Month to month", 4: "Owner", 5: "Assignment", 6: "Coworking"}
LAT0, FT = 29.7575, 3.281
MX, MY = 111320 * math.cos(math.radians(LAT0)), 110540        # metres per degree of longitude / latitude
STOP = {"the", "building", "bldg", "tower", "towers", "center", "centre", "plaza", "at", "of", "and"}
STREET = {"street", "st", "avenue", "ave", "av", "boulevard", "blvd", "road", "rd", "drive", "dr", "parkway", "pkwy",
          "pky", "lane", "ln", "place", "pl", "way", "court", "ct", "freeway", "fwy"}


def floor_no(code):
    """CoStar FloorName code -> floor number. Plaza / Lobby / Ground / FirstFloor are floor 1; basements, parking,
    mechanical levels, mezzanines and penthouses have no number (None)."""
    if code in (21, 22, 23, 24, 152):
        return 1
    if code == 25:
        return 2
    return code - 24 if code and 27 <= code <= 149 else None


def spec(floors):
    """[3, 4, 5, 9] -> '3-5;9' (the vacant_floors / floors format of real-data/*.csv)."""
    out, run = [], []
    for f in sorted(set(floors)):
        if run and f == run[-1] + 1:
            run.append(f)
        else:
            if run:
                out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
            run = [f]
    if run:
        out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
    return ";".join(out)


# ---------------- map geometry ----------------
def point_in(ring, x, y):
    c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def dist_m(ring, lon, lat):
    """0 inside the footprint, else metres to its outline."""
    if point_in(ring, lon, lat):
        return 0.0
    best = math.inf
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        ax, ay, bx, by = (x1 - lon) * MX, (y1 - lat) * MY, (x2 - lon) * MX, (y2 - lat) * MY
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) or 1)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def words(s):
    return [w for w in re.split(r"[^a-z0-9]+", (s or "").lower()) if w]


def street_key(number, name):
    """'1000', 'Main' -> '1000 main' ('Street', 'St', 'Avenue'... dropped)."""
    ws = [w for w in words(f"{number or ''} {name or ''}") if w not in STREET]
    return " ".join(ws) if len(ws) >= 2 and ws[0][0].isdigit() else None


def osm_street_key(addr):
    """'1000 Main Street' -> '1000 main'."""
    m = re.match(r"\s*(\S+)\s+(.+)", addr or "")
    return street_key(m.group(1), m.group(2)) if m else None


def names_match(a, b):
    sa, sb = {w for w in words(a) if w not in STOP}, {w for w in words(b) if w not in STOP}
    return bool(sa and sb) and len(sa & sb) / len(sa | sb) >= 0.5


def osm_height_ft(p):
    return p["height"] * FT if p.get("heightSource") != "default" else None


def match_footprints(towers, feats):
    """Score every nearby footprint for every tower; assign the best pairs first, one footprint per tower."""
    pairs = []
    for t in towers:
        H = t["costar_height_ft"] or t["stories"] * 13.0
        for f in feats:
            p, ring = f["properties"], f["geometry"]["coordinates"][0]
            d = dist_m(ring, t["lon"], t["lat"])
            if d > 150:
                continue
            addr = bool(t["street_keys"] & {osm_street_key(p.get("addr"))} - {None})
            name = any(names_match(n, p.get("name")) for n in t["names"]) if p.get("name") else False
            h = osm_height_ft(p)
            fit = -min(1.5, abs(math.log(h / H))) if h else -0.3
            score = 3.0 * addr + 2.0 * name + 1.5 * (d == 0) - d / 50 + fit - 2.0 * (p.get("kind") == "parking")
            how = "+".join(k for k, on in (("address", addr), ("name", name), ("inside", d == 0)) if on) or f"nearest {d:.0f} m"
            pairs.append((score, t["id"], p["id"], how))
    pairs.sort(key=lambda x: -x[0])
    by_tower, used = {}, set()
    for score, tid, oid, how in pairs:
        if tid in by_tower or oid in used or score <= -1.0:
            continue
        by_tower[tid], used = (oid, how), used | {oid}
    return by_tower


# ---------------- the kit ----------------
def jsonl(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def load_kit(kit: Path, bbox, today: str, min_stories: int):
    props, multis = {}, []
    for r in jsonl(kit / "data" / "commercial-property.jsonl"):
        a = r.get("primaryAddress") or {}
        lat, lon = a.get("latitude"), a.get("longitude")
        if a.get("researchMarketId") != HOUSTON or lat is None or lon is None:
            continue
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        if r.get("propertyType") == OFFICE and (r.get("numStoriesAboveGrade") or 0) >= min_stories:
            props[r["id"]] = r
        elif r.get("propertyType") == MULTIFAMILY:
            multis.append(r)
    ids = set(props)
    occ = defaultdict(list)
    for r in jsonl(kit / "data" / "location-occupancy.jsonl"):
        if r.get("propertyId") in ids and not r.get("toDate"):
            occ[r["propertyId"]].append(r)
    spaces = defaultdict(dict)   # on-market space for lease, by property, deduplicated by space id
    for r in jsonl(kit / "data" / "commercial-listing-summary.jsonl"):
        fl = r.get("forLeaseSummary")
        if r.get("listingStatus") != 1 or not fl:
            continue
        for s in fl.get("spaces") or []:
            if s.get("propertyId") in ids and not s.get("dateOffMarket"):
                spaces[s["propertyId"]][s["id"]] = (r.get("listingType"), s)
    sales = defaultdict(list)
    for r in jsonl(kit / "data" / "commercial-sale-comp.jsonl"):
        for e in r.get("entities") or []:
            if e.get("propertyId") in ids and e.get("percentLeased") is not None:
                sales[e["propertyId"]].append((str(r.get("soldDate") or "")[:10], e["percentLeased"]))
    want = {o.get("tenantLocationId") for v in occ.values() for o in v}
    want |= {c.get("locationId") for p in props.values() for c in p.get("contacts") or [] if c.get("contactRole") in (3, 7)}
    companies = {r["id"]: r for r in jsonl(kit / "data" / "company-detail.jsonl") if r["id"] in want}
    models = defaultdict(list)
    with open(kit / "commercial-properties.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            pid = int(row["PropertyId"]) if row.get("PropertyId") else None
            if pid in ids and row.get("MatterportModelId") and row["MatterportModelId"] not in models[pid]:
                models[pid].append(row["MatterportModelId"])
    industry = json.loads((kit / "schemas" / "enums.json").read_text(encoding="utf-8")).get("IndustryType", {})
    return props, multis, occ, spaces, sales, companies, models, industry


def company_name(c):
    return (c or {}).get("name") or ((c or {}).get("profile") or {}).get("companyName")


def build(kit: Path, geo: Path, today: str, min_stories: int):
    feats = json.loads(geo.read_text(encoding="utf-8"))["features"]
    xs = [q[0] for f in feats for q in f["geometry"]["coordinates"][0]]
    ys = [q[1] for f in feats for q in f["geometry"]["coordinates"][0]]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    props, multis, occ, spaces, sales, companies, models, industry = load_kit(kit, bbox, today, min_stories)
    by_osm = {f["properties"]["id"]: f for f in feats}

    towers = []
    for pid, r in props.items():
        a = r["primaryAddress"]
        keys = {k for k in (street_key(x.get("streetNumber"), x.get("streetName")) for x in [a] + (r.get("addresses") or [])) if k}
        towers.append({"id": pid, "lat": a["latitude"], "lon": a["longitude"], "stories": r["numStoriesAboveGrade"],
                       "costar_height_ft": r.get("buildingHeightInFeet"), "street_keys": keys,
                       "names": [n for n in [r.get("buildingName")] + (r.get("aliases") or []) if n]})
    matched = match_footprints(towers, feats)

    rows, tenant_rows, report = [], [], []
    for pid, r in sorted(props.items(), key=lambda kv: -kv[1]["numStoriesAboveGrade"]):
        a, stories = r["primaryAddress"], r["numStoriesAboveGrade"]
        if pid not in matched:
            report.append(f"  {pid:>9}  NO MATCH within 150 m: {r.get('buildingName') or ''} {a.get('streetNumber')} {a.get('streetName')}")
            continue
        oid, how = matched[pid]
        feat = by_osm[oid]
        st = ((r.get("propertyOffice") or {}).get("structural") or {})
        rba = r.get("rentableBuildingAreaSquareFeet") or r.get("grossBuildingAreaSquareFeet")
        typical = r.get("grossTypicalFloorSquareFeet")
        events = r.get("constructionEvents") or []
        built = next((e["year"] for e in events if e.get("eventType") == EVENT_COMPLETE and e.get("year")), None) \
            or min((e["year"] for e in events if e.get("year")), default=None)
        renovated = max((e["year"] for e in events if e.get("eventType") == EVENT_RENOVATED and e.get("year")), default=None)
        conv = next((e["year"] for e in events if e.get("eventType") == EVENT_CONVERTED and e.get("year")), None)
        if conv is None and r.get("constructionStatus") == STATUS_CONVERTED:
            conv = max((e["year"] for e in events if e.get("year")), default=None)
        converted_to = ""
        if conv:
            ring = feat["geometry"]["coordinates"][0]
            for m in multis:
                ma = m["primaryAddress"]
                if point_in(ring, ma["longitude"], ma["latitude"]):
                    units = (m.get("propertyApartment") or {}).get("totalNumUnits")
                    yrs = [e["year"] for e in m.get("constructionEvents") or [] if e.get("year")]
                    converted_to = f"{m.get('buildingName') or 'apartments'} (apartments{', ' + str(units) + ' homes' if units else ''}{', ' + str(max(yrs)) if yrs else ''})"
                    break

        # height: keep OpenStreetMap's when it fits the storey count, else CoStar's (or storeys x 13 ft, an estimate)
        osm_ft = osm_height_ft(feat["properties"])
        height_m, height_src = "", ""
        osm_ok = bool(osm_ft and 2.8 <= osm_ft / FT / stories <= 6.0)
        if not osm_ok:
            ch = r.get("buildingHeightInFeet")
            if ch and 9.5 <= ch / stories <= 20:
                height_m, height_src = round(ch / FT, 1), "COSTAR"
            else:
                height_m, height_src = round(stories * 13.0 / FT, 1), "ESTIMATE"

        # floor-to-floor: CoStar's slab-to-slab when the building's height agrees
        s2s, f2f, f2f_note = st.get("slabToSlabHeightFeet"), "", ""
        if s2s:
            ch = r.get("buildingHeightInFeet")
            ref = ch / stories if ch and 9.5 <= ch / stories <= 20 else (osm_ft / stories if osm_ok else None)
            if 8 <= s2s <= 20 and (ref is None or abs(s2s - ref) <= 2.5):
                f2f = s2s
                f2f_note = f"CoStar slab-to-slab {s2s:g} ft" + (f"; height / storeys = {ref:.1f} ft" if ref else "")
            else:
                f2f_note = (f"CoStar lists {s2s:g} ft slab-to-slab, but height / storeys gives {ref:.1f} ft: measure on site"
                            if ref else f"CoStar lists {s2s:g} ft slab-to-slab, outside 8-20 ft: measure on site")

        # leasing: 100% - vacant direct space on the market now / RBA; else the share leased at the latest sale
        cur = occ[pid]
        on_market = list(spaces[pid].values())
        vacant_now = [s for lt, s in on_market if lt in DIRECT_LISTINGS and (s.get("spaceType") or 0) in DIRECT_SPACES
                      and s.get("availableOnDate") and s["availableOnDate"][:10] <= today]
        vac_sf = sum(s.get("squareFeetMax") or s.get("squareFeetMin") or 0 for s in vacant_now)
        avail_sf = sum(s.get("squareFeetMax") or s.get("squareFeetMin") or 0 for _, s in on_market)
        sale = max(sales[pid], default=None)
        leased, method = None, ""
        if (cur or on_market) and rba:
            leased = max(0.0, min(1.0, 1 - vac_sf / rba))
            method = (f"100% - vacant direct space on the market now ({len(vacant_now)} spaces, {vac_sf:,.0f} sq ft) "
                      f"/ RBA {rba:,.0f} sq ft")
        elif sale:
            leased = sale[1] / 100
            method = f"share leased at its latest sale ({sale[0]}); no current tenancy or listing on record"
        occupied_sf = sum(s.get("squareFeetOccupied") or 0 for o in cur for s in o.get("spaces") or [])

        # empty floors: 80%+ of the typical floor vacant on the market now, or every floor of an empty tower
        per_floor = defaultdict(float)
        full = set()
        for s in vacant_now:
            f = floor_no(s.get("floorName"))
            if f and 2 <= f <= stories:
                per_floor[f] += s.get("squareFeetMax") or s.get("squareFeetMin") or 0
                if s.get("isFullFloor"):
                    full.add(f)
        empty = sorted(full | {f for f, v in per_floor.items() if typical and v >= FULL_FLOOR * typical})
        if leased is not None and leased <= 0.02 and not cur:
            empty = list(range(2, stories + 1))

        # tenants on known office floors (floors already counted empty are left out)
        fmap = {fl["propertyFloorId"]: floor_no(fl.get("floorName")) for fl in r.get("floors") or []}
        sharing = defaultdict(int)
        tens = []
        for o in cur:
            fls = sorted({fmap.get(s.get("propertyFloorId")) for s in o.get("spaces") or []} - {None})
            fls = [f for f in fls if 2 <= f <= stories and f not in empty]
            if not fls:
                continue
            for f in fls:
                sharing[f] += 1
            ld = o.get("leaseDeal") or {}
            exp = str(ld.get("expirationDate") or "")[:10]
            comp = companies.get(o.get("tenantLocationId"))
            ind = ((comp or {}).get("profile") or {}).get("industryType")
            tens.append({"floors": fls, "name": company_name(comp) or "Unidentified tenant",
                         "sf": sum(s.get("squareFeetOccupied") or 0 for s in o.get("spaces") or []),
                         "lease_end": int(exp[:4]) if exp and exp >= today else "", "lease_end_date": exp[:7] if exp and exp >= today else "",
                         "lease_type": LEASE_TYPE.get(o.get("leaseType") or 0, ""),
                         "industry": industry.get(str(ind), "") if ind else ""})
        for t in tens:
            est = not t["sf"]
            sqft = round(t["sf"]) if t["sf"] else round(sum((typical or 20000) / sharing[f] for f in t["floors"]))
            tenant_rows.append({"costar_id": pid, "tenant": t["name"], "floors": spec(t["floors"]), "sqft": sqft,
                                "sqft_estimated": "true" if est else "", "lease_end": t["lease_end"],
                                "lease_end_date": t["lease_end_date"], "lease_type": t["lease_type"],
                                "industry": "" if t["industry"] in ("Unknown", "None") else t["industry"], "source": "costar"})

        owner = ""
        for role in (7, 3):   # true owner, then recorded owner
            for c in r.get("contacts") or []:
                if c.get("contactRole") == role and company_name(companies.get(c.get("locationId"))):
                    owner = company_name(companies.get(c.get("locationId")))
                    break
            if owner:
                break
        spaces_total = sum(p.get("totalSpaces") or 0 for p in r.get("parking") or [])
        sprk = r.get("hasSprinklers")
        rows.append({
            "costar_id": pid, "address": " ".join(x for x in (a.get("streetNumber"), a.get("streetName"), a.get("streetType")) if x),
            "lat": a["latitude"], "lon": a["longitude"], "property_type": "Office",
            "leased_pct": "" if leased is None else round(leased * 100, 1), "year_built": built or "", "rba_sqft": round(rba) if rba else "",
            "floors": stories, "owner": owner, "vacant_floors": (spec(empty) or "none") if leased is not None else "",
            "osm_id": oid, "match": how, "building_name": r.get("buildingName") or "",
            "building_class": CLASS.get(r.get("buildingClass"), ""), "star_rating": r.get("buildingRating") or "",
            "year_renovated": renovated or "", "height_m": height_m, "height_src": height_src,
            "typical_floor_sqft": round(typical) if typical else "", "floor_to_floor_ft": f2f, "f2f_note": f2f_note,
            "sprinklers": "" if sprk is None else ("yes" if sprk else "no"), "parking_spaces": spaces_total or "",
            "converted_year": conv or "", "converted_to": converted_to,
            "photo_url": (r.get("primaryPhoto") or {}).get("attachmentUri") or "", "matterport_models": ";".join(models[pid]),
            "leased_method": method, "leased_tenancy_pct": round(occupied_sf / rba * 100, 1) if rba and cur else "",
            "sale_leased_pct": sale[1] if sale else "", "sale_date": sale[0] if sale else "",
            "available_sqft": round(avail_sf), "vacant_now_sqft": round(vac_sf), "tenants_current": len(cur),
            "tenants_with_lease_end": sum(1 for t in tens if t["lease_end"] != ""),
        })
        flags = [x for x in (f"height {height_src}" if height_src else "", "f2f conflict" if f2f_note and not f2f else "",
                             f"converted {conv}" if conv else "") if x]
        report.append(f"  {pid:>9}  {(r.get('buildingName') or rows[-1]['address'])[:24]:<24} osm {oid:<11} {how:<22} "
                      f"leased {'?' if leased is None else f'{leased * 100:3.0f}%'}  empty floors {len(empty):>2}  tenants {len(tens):>2}"
                      + (f"  [{', '.join(flags)}]" if flags else ""))
    return rows, tenant_rows, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kit", default=os.environ.get("COSTAR_KIT_DIR") or str(ROOT.parent / "costar-hackathon-kit"),
                    help="folder of the CoStar data kit (holds index.md, data/, schemas/)")
    ap.add_argument("--out", default=str(OUT), help="where to write costar.csv and tenants.csv")
    ap.add_argument("--geo", default=str(GEOJSON))
    ap.add_argument("--today", default=dt.date.today().isoformat(), help="date for 'available now' and future lease ends")
    ap.add_argument("--min-stories", type=int, default=6)
    a = ap.parse_args()
    kit = Path(a.kit).expanduser()
    kit = kit if kit.is_absolute() else (ROOT / kit).resolve()   # a relative path in .env is relative to the project
    if not (kit / "data" / "commercial-property.jsonl").exists():
        sys.exit(f"CoStar kit not found at {kit}. Pass --kit /path/to/costar-hackathon-kit or set COSTAR_KIT_DIR in .env.")
    rows, tenants, report = build(kit, Path(a.geo), a.today, a.min_stories)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in (("costar.csv", rows), ("tenants.csv", tenants)):
        if data:
            with open(out / name, "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(data[0]))
                w.writeheader()
                w.writerows(data)
    print(f"CoStar kit: {len(rows)} downtown office towers, {len(tenants)} current tenancies on known floors (as of {a.today}).")
    print("\n".join(report))
    print(f"Wrote {out / 'costar.csv'} and {out / 'tenants.csv'}. Next: python backend/import_data.py")


if __name__ == "__main__":
    main()
