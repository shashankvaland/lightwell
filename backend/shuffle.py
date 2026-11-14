"""Texas fast-track screen + tenant moves. Python copy of lightwell/js/shuffle.js (keep the two in sync; parity-tested).

Texas SB 840 / SB 2477 (in force 1 Sep 2025; cities over 150k people in counties over 300k, so Houston qualifies):
an office building at least 5 years old can convert to homes without rezoning, traffic studies or extra parking if at
least 65% of the building (and of each occupied floor) becomes residential. This is a screen, not legal advice.
"""
from __future__ import annotations

import math
import re

from engine import DEFAULT_ASSUMPTIONS, Building, jround

P = {"year": 2026, "minAge": 5, "resShare": 0.65, "farM": 800, "longLease": 5}
INDUSTRY = ["Energy", "Law firm", "Engineering", "Bank", "Consulting", "Insurance", "Tech", "Public agency"]
FT_LABEL = {"ready": "Fast-track ready", "shuffle": "Needs tenant moves", "too_new": "Too new (under 5 years)",
            "unknown": "Unknown (no floor data)"}


def _num(b: Building) -> int:
    d = re.sub(r"\D", "", str(b.id))
    return int(d) if d else 0


def _known(b: Building) -> bool:
    return (b.src or {}).get("vacant", "MISSING") != "MISSING"


def tenants_of(b: Building):
    if isinstance(b.tenants, list):
        return b.tenants
    if not _known(b):
        return None
    n, empty, k, out = b.floors, set(b.vacantFloors or []), _num(b), []
    f = 2
    while f <= n:
        if f in empty:
            f += 1
            continue
        size, floors = 1 + ((k * 3 + f) % 4), []
        while f <= n and f not in empty and len(floors) < size:
            floors.append(f)
            f += 1
        i = len(out)
        out.append({"name": f"{INDUSTRY[(k + floors[0]) % 8]} tenant {chr(65 + (i % 26))}", "floors": floors,
                    "sqft": jround(len(floors) * b.W * b.D), "lease_end": P["year"] + ((k * 7 + floors[0] * 13) % 9),
                    "src": "SIMULATED"})
    return out


def fast_track(b: Building) -> dict:
    n = b.floors
    age = None if b.year is None else P["year"] - b.year
    known = _known(b)
    free = len(b.vacantFloors or []) if known else None
    need = math.ceil(P["resShare"] * n - 1e-9)
    short = max(0, need - free) if known else None
    status = ("unknown" if not known else "too_new" if age is not None and age < P["minAge"]
              else "ready" if short == 0 else "shuffle")
    return {"status": status, "floors": n, "need": need, "free": free, "short": short, "age": age,
            "ageKnown": age is not None, "share": (free / n) if known else None}


def _dist(a: Building, c: Building) -> float:
    lat = (a.center[1] + c.center[1]) / 2 * math.pi / 180
    return math.hypot((a.center[0] - c.center[0]) * math.cos(lat) * 111320, (a.center[1] - c.center[1]) * 110540)


def plan_moves(t: Building, B: list[Building], goal: str = "fast", A: dict | None = None):
    A = {**DEFAULT_ASSUMPTIONS, **(A or {})}
    ft, tenants = fast_track(t), tenants_of(t)
    if not tenants or ft["status"] == "unknown":
        return None
    want = sum(len(x["floors"]) for x in tenants) if goal == "empty" else ft["short"]
    order = sorted(tenants, key=lambda x: (x["lease_end"], len(x["floors"]), x["floors"][0]))
    pick, freed = [], 0
    for x in order:
        if freed >= want:
            break
        pick.append(x)
        freed += len(x["floors"])
    idx = {id(r): i for i, r in enumerate(B)}
    cap = {}
    for r in B:
        if r is not t and _known(r) and r.vacantFloors:
            cap[id(r)] = [r, len(r.vacantFloors) * r.W * r.D]
    moves, unplaced = [], []
    for x in pick:
        opts = sorted(((v[0], _dist(t, v[0])) for v in cap.values() if v[1] >= x["sqft"]),
                      key=lambda o: (1 if o[0].passes else 0, o[1], idx[id(o[0])]))
        yrs = max(0, x["lease_end"] - P["year"] - 1)
        cost = x["sqft"] * (A["moveCostSqft"] + A["buyoutSqftYr"] * yrs)
        if not opts:
            unplaced.append({"tenant": x["name"], "sqft": x["sqft"], "floors": x["floors"]})
            continue
        r, d = opts[0]
        cap[id(r)][1] -= x["sqft"]
        moves.append({"tenant": x["name"], "floors": x["floors"], "sqft": x["sqft"], "lease_end": x["lease_end"],
                      "src": x.get("src", "COSTAR"), "from": t.id, "to": r.id, "to_passes": bool(r.passes),
                      "dist_m": jround(d), "cost": jround(cost), "buyout_years": yrs})
    moved = sum(len(m["floors"]) for m in moves)
    per = t.plan["perFloor"] if t.plan else 0
    cost = sum(m["cost"] for m in moves)
    gained = moved * per
    receivers = list(dict.fromkeys(m["to"] for m in moves))
    return {"tower": t.id, "goal": goal, "want": want, "moves": moves, "unplaced": unplaced, "freed_floors": moved,
            "cost": cost, "homes_now": ft["free"] * per, "homes_after": (ft["free"] + moved) * per, "homes_gained": gained,
            "cost_per_home_gained": jround(cost / gained) if gained else None,
            "fast_track_after": ft["status"] != "too_new" and ft["free"] + moved >= ft["need"], "receivers": receivers}


def challenge_plan(t: Building, plan: dict | None, B: list[Building]) -> dict:
    out, ft, by_id = [], fast_track(t), {b.id: b for b in B}
    if not plan:
        return {"verdict": "no_plan", "risks": [{"level": "high", "text": f"{t.id} has no floor-by-floor data, so no move plan can be made."}]}
    if not t.passes:
        out.append({"level": "high", "text": f"{t.id} itself doesn't pass the brief ({', '.join(t.why or [])}): emptying it may not lead to homes."})
    if ft["status"] == "too_new":
        out.append({"level": "high", "text": f"{t.id} is under {P['minAge']} years old, so the Texas fast-track doesn't apply."})
    if not ft["ageKnown"]:
        out.append({"level": "medium", "text": f"Year built is missing for {t.id}: fast-track eligibility (5+ years old) is unverified."})
    for m in plan["moves"]:
        if m["lease_end"] - P["year"] >= P["longLease"]:
            out.append({"level": "high", "text": f"{m['tenant']} has a lease to {m['lease_end']}: they can refuse, and a buyout of "
                        f"~${jround(m['cost'] / 1e5) / 10:g}M is an estimate."})
    for m in plan["moves"]:
        if m["dist_m"] > P["farM"]:
            out.append({"level": "medium", "text": f"{m['tenant']} would move {m['dist_m']} m to {m['to']}: far enough that they may prefer to leave downtown."})
    for rid in plan["receivers"]:
        r = by_id.get(rid)
        if r and r.passes:
            out.append({"level": "medium", "text": f"{rid} receives tenants but is itself a conversion candidate: filling it blocks its own homes."})
    if plan["unplaced"]:
        out.append({"level": "high", "text": f"{len(plan['unplaced'])} tenant(s) have no tower nearby with enough empty space."})
    if not plan["fast_track_after"] and plan["goal"] == "fast":
        out.append({"level": "high", "text": "The moves don't reach 65% residential, so the fast-track still doesn't apply."})
    if any(m["src"] != "COSTAR" for m in plan["moves"]):
        out.append({"level": "low", "text": "Tenant list and leases are simulated until CoStar tenant records are imported."})
    high = sum(1 for x in out if x["level"] == "high")
    verdict = "weak" if high else "holds_with_caveats" if any(x["level"] == "medium" for x in out) else "holds"
    return {"verdict": verdict, "risks": out}
