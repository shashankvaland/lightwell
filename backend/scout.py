"""Data scout: works on the towers that have no CoStar record. Mirrors lightwell/js/scout.js (parity-tested).

scout_gaps: estimates percent leased for towers with no CoStar record from the most similar CoStar towers (nearby,
similar height), pulled toward the downtown average. Tagged ESTIMATE with a range, a confidence and its sources.
data_priority: which towers are most worth asking CoStar about next (where what we don't know changes the decision).
"""
from __future__ import annotations

import math
from dataclasses import replace

from engine import Building, analyze, clamp, jround
from shuffle import fast_track

SC = {"prior": 0.748, "priorW": 1, "k": 5, "nearM": 600, "minHalf": 0.08, "repLo": 0.55, "repHi": 0.95,
      "yearOld": 1965, "yearNew": 2000, "priorSrc": "CBRE Houston office figures Q4 2025: 25.2% vacant"}


def _r2(x):
    return jround(x * 100) / 100


def _src(b: Building, k: str) -> str:
    return (b.src or {}).get(k, "MISSING")


def _dist(a: Building, c: Building) -> int:
    lat = (a.center[1] + c.center[1]) / 2 * math.pi / 180
    return jround(math.hypot((a.center[0] - c.center[0]) * math.cos(lat) * 111320, (a.center[1] - c.center[1]) * 110540))


def scout_gaps(B: list[Building]) -> list[dict]:
    ref = [b for b in B if _src(b, "rep") == "COSTAR" and b.rep is not None and b.center]
    out = []
    for b in B:
        if _src(b, "rep") != "MISSING" or not b.center:
            continue
        nb = []
        for k in ref:
            d = _dist(b, k)
            nb.append({"k": k, "d": d, "w": 1 / (1 + d / 400) / (1 + abs(k.floors - b.floors) / 15)})
        nb.sort(key=lambda x: (-x["w"], x["d"]))
        nb = nb[:SC["k"]]
        sw = sv = 0.0
        for x in nb:
            sw += x["w"]
            sv += x["w"] * x["k"].rep
        est = (sv + SC["priorW"] * SC["prior"]) / (sw + SC["priorW"])
        ss = 0.0
        for x in nb:
            ss += x["w"] * (x["k"].rep - est) ** 2
        half = max(SC["minHalf"], math.sqrt(ss / sw) if sw else 0.15)
        near = sum(1 for x in nb if x["d"] <= SC["nearM"])
        out.append({"id": b.id, "field": "rep", "value": _r2(est), "lo": _r2(clamp(est - half, 0.05, 0.99)),
                    "hi": _r2(clamp(est + half, 0.05, 0.99)), "confidence": "medium" if near >= 3 else "low", "near": near,
                    "neighbours": [{"id": x["k"].id, "leased": _r2(x["k"].rep), "dist_m": x["d"]} for x in nb],
                    "basis": (f"weighted average of {len(nb)} similar CoStar towers ({near} within {SC['nearM']} m), pulled toward the downtown average"
                              if nb else "downtown average only (no CoStar towers loaded)")})
    return out


def apply_estimates(buildings: dict, items: list[dict]) -> int:
    n = 0
    for e in items or []:
        b = buildings.get(e["id"])
        if b is None or _src(b, "rep") != "MISSING":
            continue
        b.rep = e["value"]
        b.src["rep"] = "ESTIMATE"
        n += 1
    return n


def data_priority(B: list[Building], S=None, A=None, n: int = 5) -> list[dict]:
    out = []
    for b in B:
        if _src(b, "rep") in ("COSTAR", "YOU") or b.converted:
            continue
        if b.plan is None:
            analyze(b, S, A)
        year_unknown = _src(b, "year") not in ("COSTAR", "YOU")
        reps = [SC["repLo"], SC["repHi"]]
        years = [SC["yearOld"], SC["yearNew"]] if year_unknown else [b.year]
        runs = []
        for rep in reps:
            for year in years:
                t = analyze(replace(b, rep=rep, year=year), S, A)
                runs.append({"rep": rep, "year": year, "score": t.score, "pass": t.passes})
        scores = [x["score"] for x in runs]
        lo, hi = min(scores), max(scores)
        pass_flip = any(x["pass"] for x in runs) and any(not x["pass"] for x in runs)
        year_flip = year_unknown and any(
            [x for x in runs if x["rep"] == rep][0]["pass"] != [x for x in runs if x["rep"] == rep][1]["pass"] for rep in reps)
        ft = fast_track(b)
        floors_unknown = ft["status"] == "unknown" or _src(b, "vacant") == "SIMULATED"
        reasons = []
        if pass_flip:
            reasons.append("passes or fails depending on year built (pre-1980 abatement and sprinkler costs)" if year_flip
                           else "passes or fails depending on occupancy")
        if hi - lo >= 5:
            reasons.append(f"score could be anywhere from {lo} to {hi} depending on occupancy{' and age' if year_unknown else ''}")
        if b.passes and floors_unknown:
            reasons.append("the Texas 65% check needs floor-by-floor availability")
        if not reasons:
            continue
        priority = (40 if pass_flip else 0) + (hi - lo) + (15 if b.passes else 0) + (10 if b.passes and floors_unknown else 0)
        out.append({"id": b.id, "priority": priority, "score": b.score, "passes": b.passes, "score_lo": lo, "score_hi": hi,
                    "pass_flip": pass_flip, "reasons": reasons,
                    "need": ["occupancy"] + (["year built"] if year_unknown else []) + (["available floors"] if floors_unknown else [])})
    out.sort(key=lambda x: (-x["priority"], -x["score"], x["id"]))
    return out[:n]
