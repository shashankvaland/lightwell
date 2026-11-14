"""Lightwell feasibility engine (Python mirror of lightwell/js/engine.js).

Keep the two files in sync: the browser and the agent must agree on every number.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

DEFAULT_ASSUMPTIONS = {
    "costPerSqft": 255, "abatement": 20, "lightwellPerSqft": 420, "sprinklerPerSqft": 9,
    "newBuildPerHome": 400000, "carbonKgPerM2": 500, "reuseSaving": 0.6, "f2fMin": 12.5, "maxTravelFt": 250,
}
DEFAULT_CONSTRAINTS = {"u": 30, "cap": 300000, "allowLW": True}


def jround(x: float) -> int:
    """JavaScript Math.round (halves round up), so results match the browser exactly."""
    return math.floor(x + 0.5)


def clamp(x, a, b):
    return max(a, min(b, x))


def area(r):
    return (r[2] - r[0]) * (r[3] - r[1])


@dataclass
class Building:
    id: str
    W: float
    D: float
    heightM: float
    floors: int
    f2f: float
    year: int
    rep: float
    obs: list
    scanned: bool
    core: list | None = None          # [x0, y0, x1, y1] in plate feet, from a Matterport scan
    forceLW: bool | None = None
    plan: dict | None = field(default=None, repr=False)
    alt: dict | None = field(default=None, repr=False)
    score: int | None = None
    passes: bool = False
    phantom: bool = False
    vac: float = 0.0
    courtOK: bool = False


def layout(W, D, u, lw, core=None):
    units, cores, court = [], [], None

    def strip(x0, y0, x1, y1, hor):
        length = x1 - x0 if hor else y1 - y0
        dep = y1 - y0 if hor else x1 - x0
        if length < 14 or dep < 14:
            return
        pat = [22, 30, 36, 30]
        n = max(1, jround(length / 29.5))
        raw = [pat[i % len(pat)] for i in range(n)]
        k = length / sum(raw)
        p = 0.0
        for rw in raw:
            w = rw * k
            rr = [x0 + p, y0, x0 + p + w, y1] if hor else [x0, y0 + p, x1, y0 + p + w]
            p += w
            a = w * dep
            units.append({"r": rr, "a": a, "t": 0 if a < 700 else 1 if a < 980 else 2})

    if lw:
        wing = 2 * u + 6
        court = [wing, wing, W - wing, D - wing]
    uy, ux = min(u, D / 2), min(u, W / 2)
    strip(0, 0, W, uy, True)
    strip(0, D - uy, W, D, True)
    if D - 2 * uy > 14:
        strip(0, uy, ux, D - uy, False)
        strip(W - ux, uy, W, D - uy, False)
    if court:
        a, b, c, d = court
        strip(a - u, b - u, c + u, b, True)
        strip(a - u, d, c + u, d + u, True)
        strip(a - u, b, a, d, False)
        strip(c, b, c + u, d, False)
        cores += [[a, b, a + 26, b + 26], [c - 26, d - 26, c, d]]
    elif core:
        cores.append(list(core))
    else:
        cw = max(40, jround(W * 0.26 / 10) * 10)
        cd = max(30, jround(D * 0.2 / 10) * 10)
        cores.append([(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2])
    return {"units": units, "court": court, "cores": cores}


def court_ok(b: Building, u):
    wing = 2 * u + 6
    return b.W - 2 * wing >= 30 and b.D - 2 * wing >= 30


def safety(b: Building, L, A):
    def dist_to_rect(x, y, r):
        return max(r[0] - x, 0, x - r[2]) + max(r[1] - y, 0, y - r[3])

    travel = 0.0
    for un in L["units"]:
        cx, cy = (un["r"][0] + un["r"][2]) / 2, (un["r"][1] + un["r"][3]) / 2
        travel = max(travel, min(dist_to_rect(cx, cy, c) for c in L["cores"]) + 10)
    if len(L["cores"]) >= 2:
        p, q = L["cores"][0], L["cores"][1]
        sep = math.hypot((p[0] + p[2]) / 2 - (q[0] + q[2]) / 2, (p[1] + p[3]) / 2 - (q[1] + q[3]) / 2)
    else:
        c = L["cores"][0]
        sep = math.hypot(c[2] - c[0], c[3] - c[1])
    req = math.hypot(b.W, b.D) / 3
    retrofit = b.year < 1975
    notes = []
    if travel > A["maxTravelFt"]:
        notes.append(f"Farthest home is {jround(travel)} ft from a stair (limit ~{A['maxTravelFt']} ft)")
    if sep < req:
        notes.append(f"Stairs {jround(sep)} ft apart; needs ~{jround(req)} ft: add a remote stair")
    if retrofit:
        notes.append("Built before 1975: assume a full sprinkler retrofit")
    status = "fail" if travel > A["maxTravelFt"] * 1.2 else ("check" if travel > A["maxTravelFt"] or sep < req else "ok")
    return {"travel": travel, "sep": sep, "req": req, "retrofit": retrofit, "status": status, "notes": notes}


def plan(b: Building, u, lw, A):
    L = layout(b.W, b.D, u, lw, b.core)
    fu = b.floors - 1
    per_floor = len(L["units"])
    homes = per_floor * fu
    daylit = sum(x["a"] for x in L["units"])
    core_a = sum(area(c) for c in L["cores"])
    court_a = area(L["court"]) - core_a if L["court"] else 0
    net = b.W * b.D - (area(L["court"]) if L["court"] else core_a)
    gsf = (b.W * b.D - court_a) * fu
    safe = safety(b, L, A)
    cost = (gsf * A["costPerSqft"] + (gsf * A["abatement"] if b.year < 1980 else 0)
            + (court_a * fu * A["lightwellPerSqft"] if lw else 0) + (gsf * A["sprinklerPerSqft"] if safe["retrofit"] else 0))
    return {
        "lw": lw, "perFloor": per_floor, "homes": homes, "daylitFrac": clamp(daylit / net, 0, 1), "gsf": gsf, "cost": cost,
        "cpu": cost / homes if homes else math.inf, "mix": [sum(1 for x in L["units"] if x["t"] == t) * fu for t in range(3)],
        "safety": safe, "carbon": gsf * 0.0929 * A["carbonKgPerM2"] * A["reuseSaving"] / 1000,
    }


def analyze(b: Building, S=None, A=None) -> Building:
    S = {**DEFAULT_CONSTRAINTS, **(S or {})}
    A = {**DEFAULT_ASSUMPTIONS, **(A or {})}
    p0 = plan(b, S["u"], False, A)
    ok = court_ok(b, S["u"])
    p1 = plan(b, S["u"], True, A) if ok else None
    p = p0
    if b.forceLW is True and p1:
        p = p1
    elif b.forceLW is None and S["allowLW"] and p1 and p1["cpu"] < p0["cpu"]:
        p = p1
    b.alt = p1 if p is p0 else p0
    b.plan, b.courtOK = p, ok
    obs_avg = sum(b.obs) / len(b.obs)   # any number of aerial captures
    vac = 1 - (0.35 * b.rep + 0.65 * obs_avg)
    cost_score = clamp(1 - (p["cpu"] - 0.6 * S["cap"]) / (0.8 * S["cap"]), 0, 1)
    age_fit = 0.6 if b.year < 1960 else 1 if b.year <= 1995 else 0.6 if b.year <= 2008 else 0.25
    safe_score = {"ok": 1, "check": 0.5, "fail": 0}[p["safety"]["status"]]
    b.vac = vac
    b.score = jround(100 * (0.30 * p["daylitFrac"] + 0.26 * vac + 0.20 * cost_score
                            + 0.06 * (1 if b.f2f >= A["f2fMin"] else 0.4) + 0.08 * age_fit + 0.10 * safe_score))
    b.passes = p["cpu"] <= S["cap"] and p["homes"] >= 20 and p["safety"]["status"] != "fail"
    b.phantom = b.rep - max(b.obs) >= 0.45
    return b


def summary(b: Building) -> dict:
    """Compact, JSON-safe view of one analysed building for the agent and the browser."""
    p = b.plan
    return {
        "id": b.id, "score": b.score, "passes": b.passes, "homes": p["homes"], "cost_per_home": jround(p["cpu"]) if p["homes"] else None,
        "lightwell": p["lw"], "daylit_pct": jround(p["daylitFrac"] * 100), "homes_per_floor": p["perFloor"],
        "mix": {"studio": p["mix"][0], "one_bed": p["mix"][1], "two_bed": p["mix"][2]},
        "fire_screen": p["safety"]["status"], "farthest_home_ft": jround(p["safety"]["travel"]), "fire_notes": p["safety"]["notes"],
        "carbon_t": jround(p["carbon"]), "hidden_vacancy_flag": b.phantom,
    }
