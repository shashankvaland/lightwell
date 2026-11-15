"""Lightwell feasibility engine (Python mirror of lightwell/js/engine.js).

Keep the two files in sync: the browser and the agent must agree on every number. tests/parity.mjs + tests/test_engine.py
check that they do.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

DEFAULT_ASSUMPTIONS = {
    "costPerSqft": 255, "abatement": 20, "lightwellPerSqft": 420, "sprinklerPerSqft": 9,
    "newBuildPerHome": 400000, "carbonKgPerM2": 500, "reuseSaving": 0.6, "f2fMin": 12.5, "f2fHard": 10.5, "maxTravelFt": 250,
    "unknownVacancy": 0.25, "unknownYear": 1970, "moveCostSqft": 15, "buyoutSqftYr": 30,
    "unknownLeaseYrs": 3,   # years of concessions assumed when a tenant's lease end is not on record (real CoStar tenants)
    # rent check (rent.py)
    "yieldOnCost": 0.065, "opexPerHomeYr": 7000, "rentVacancy": 0.05, "rentBurden": 0.30, "medianIncome": 62900,
}
DEFAULT_CONSTRAINTS = {"u": 30, "cap": 300000, "allowLW": True, "minHomes": 20, "useParking": True, "require": [],
                       "neighbours": True, "dayLim": 25, "dayStrict": False}   # last three: Daylight X-ray
LAYER_NAME = {"market": "CoStar", "aerial": "Vexcel", "interior": "Matterport"}

CORR, MIN_DEPTH, MIN_AREA = 5, 14, 300
DAY = {"eyeFt": 6.5, "lim": 25}
SAFE_LABEL = {"verify": "No blocker found, needs verification", "check": "Design work likely", "fail": "Likely blocker"}


def jround(x: float) -> int:
    """JavaScript Math.round (halves round up), so results match the browser exactly."""
    return math.floor(x + 0.5)


def clamp(x, a, b):
    return max(a, min(b, x))


def area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def inter(p, q):
    return max(0, min(p[2], q[2]) - max(p[0], q[0])) * max(0, min(p[3], q[3]) - max(p[1], q[1]))


def union_area(rs):
    """Area of the union of axis-aligned rectangles (coordinate compression), so overlaps are never double counted."""
    rs = [r for r in rs if r and area(r) > 0]
    if not rs:
        return 0
    xs = sorted({v for r in rs for v in (r[0], r[2])})
    s = 0.0
    for x0, x1 in zip(xs, xs[1:]):
        mx = (x0 + x1) / 2
        iv = sorted((r[1], r[3]) for r in rs if r[0] <= mx < r[2])
        length, cs, ce = 0.0, None, None
        for a, b in iv:
            if cs is None or a > ce:
                if cs is not None:
                    length += ce - cs
                cs, ce = a, b
            else:
                ce = max(ce, b)
        if cs is not None:
            length += ce - cs
        s += length * (x1 - x0)
    return s


@dataclass
class Building:
    id: str
    W: float
    D: float
    heightM: float
    floors: int
    f2f: float
    year: int | None
    rep: float | None
    obs: list
    scanned: bool
    core: list | None = None          # [x0, y0, x1, y1] in plate feet, from a Matterport scan or a user correction
    forceLW: bool | None = None
    real: dict = field(default_factory=dict)
    src: dict = field(default_factory=dict)   # per-field source tags sent by the browser
    vacantFloors: list = field(default_factory=list)   # empty floor numbers (CoStar available space, or simulated)
    center: list | None = None        # [lon, lat] of the footprint centre
    tenants: list | None = None       # CoStar tenant / lease records when imported; else derived in shuffle.py
    plan: dict | None = field(default=None, repr=False)
    alt: dict | None = field(default=None, repr=False)
    score: int | None = None
    passes: bool = False
    why: list = field(default_factory=list)
    phantom: bool = False
    vac: float = 0.0
    vac_basis: str = ""
    assumed: list = field(default_factory=list)
    courtOK: bool = False
    day: dict | None = None           # Daylight X-ray profile from lightwell/data/daylight.json (sent by the browser)
    sprinklers: bool | None = None    # CoStar: True = sprinklered, False = none on record, None = unknown (year rule applies)
    converted: int | None = None      # CoStar: year the building was converted to another use (it then never passes)
    rentMarket: dict | None = None    # real CoStar asking rents near the tower, summarised by the browser (rent.py)


def layout(W, D, u, lw, core=None):
    units, cores, court = [], [], None

    def strip(x0, y0, x1, y1, hor, win, court=False):
        length = x1 - x0 if hor else y1 - y0
        dep = y1 - y0 if hor else x1 - x0
        if length < MIN_DEPTH or dep < MIN_DEPTH:
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
            units.append({"r": rr, "win": win, "court": court})

    if lw:
        wing = 2 * u + 6
        court = [wing, wing, W - wing, D - wing]
        a, b, c, d = court
        cores += [[a - u, b - u, a, b], [c, d, c + u, d + u]]
        basis = "lightwell"
    elif core:
        cores.append([clamp(core[0], 0, W), clamp(core[1], 0, D), clamp(core[2], 0, W), clamp(core[3], 0, D)])
        basis = "given"
    else:
        cw = min(max(40, jround(W * 0.26 / 10) * 10), W)
        cd = min(max(30, jround(D * 0.2 / 10) * 10), D)
        cores.append([(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2])
        basis = "assumed"
    uy, ux = min(u, D / 2), min(u, W / 2)
    strip(0, 0, W, uy, True, "n")
    strip(0, D - uy, W, D, True, "s")
    if D - 2 * uy > MIN_DEPTH:
        strip(0, uy, ux, D - uy, False, "w")
        strip(W - ux, uy, W, D - uy, False, "e")
    if court:
        a, b, c, d = court
        strip(a, b - u, c + u, b, True, "s", True)
        strip(c, b, c + u, d, False, "w", True)
        strip(a - u, d, c, d + u, True, "n", True)
        strip(a - u, b, a, d, False, "e", True)

    kept = []
    for un in units:
        r, win, alive = list(un["r"]), un["win"], True
        hor = win in ("n", "s")
        for c in cores:
            ec = [c[0], c[1] - CORR, c[2], c[3] + CORR] if hor else [c[0] - CORR, c[1], c[2] + CORR, c[3]]
            if inter(r, ec) <= 1e-9:
                continue
            if win == "n":
                if ec[1] <= r[1]: alive = False
                else: r[3] = min(r[3], ec[1])
            elif win == "s":
                if ec[3] >= r[3]: alive = False
                else: r[1] = max(r[1], ec[3])
            elif win == "w":
                if ec[0] <= r[0]: alive = False
                else: r[2] = min(r[2], ec[0])
            else:
                if ec[2] >= r[2]: alive = False
                else: r[0] = max(r[0], ec[2])
            if not alive:
                break
        if not alive:
            continue
        dep = r[3] - r[1] if hor else r[2] - r[0]
        a = area(r)
        if dep < MIN_DEPTH or a < MIN_AREA:
            continue
        kept.append({"r": r, "a": a, "win": win, "court": un["court"], "t": 0 if a < 700 else 1 if a < 980 else 2})
    return {"units": kept, "court": court, "cores": cores, "coreBasis": basis}


def check_layout(L, W, D):
    """Return a list of geometry problems (empty when homes, cores and the courtyard are all disjoint and inside the plate)."""
    bad, eps = [], 0.01
    out = lambda r: r[0] < -eps or r[1] < -eps or r[2] > W + eps or r[3] > D + eps  # noqa: E731
    us, cs, ct = L["units"], L["cores"], L["court"]
    for i, u in enumerate(us):
        if out(u["r"]): bad.append(f"home {i} outside plate")
        for j, c in enumerate(cs):
            if inter(u["r"], c) > eps: bad.append(f"home {i} overlaps core {j}")
        if ct and inter(u["r"], ct) > eps: bad.append(f"home {i} overlaps lightwell")
        for j in range(i + 1, len(us)):
            if inter(u["r"], us[j]["r"]) > eps: bad.append(f"homes {i} and {j} overlap")
    for i, c in enumerate(cs):
        if out(c): bad.append(f"core {i} outside plate")
        if ct and inter(c, ct) > eps: bad.append(f"core {i} overlaps lightwell")
        for j in range(i + 1, len(cs)):
            if inter(c, cs[j]) > eps: bad.append(f"cores {i} and {j} overlap")
    return bad


def court_ok(b: Building, u):
    wing = 2 * u + 6
    return b.W - 2 * wing >= 30 and b.D - 2 * wing >= 30


def safety(b: Building, L, A):
    """Preliminary fire screen: an estimate from the plate and core rectangle, never a code review."""
    def walk(x, y, r):
        return max(r[0] - x, 0, x - r[2]) + max(r[1] - y, 0, y - r[3])

    travel = 0.0
    for un in L["units"]:
        cx, cy = (un["r"][0] + un["r"][2]) / 2, (un["r"][1] + un["r"][3]) / 2
        travel = max(travel, min(walk(cx, cy, c) for c in L["cores"]) + 10)
    if len(L["cores"]) >= 2:
        p, q = L["cores"][0], L["cores"][1]
        sep = math.hypot((p[0] + p[2]) / 2 - (q[0] + q[2]) / 2, (p[1] + p[3]) / 2 - (q[1] + q[3]) / 2)
    else:
        c = L["cores"][0]
        sep = math.hypot(c[2] - c[0], c[3] - c[1])
    req = math.hypot(b.W, b.D) / 3
    year_known = b.year is not None
    # sprinklers: CoStar's record when imported (True / False); otherwise towers built before 1975 are assumed to need them
    sprk = b.sprinklers if b.sprinklers is True or b.sprinklers is False else None
    retrofit = (not sprk) if sprk is not None else (b.year if year_known else A["unknownYear"]) < 1975
    notes = []
    if travel > A["maxTravelFt"]:
        notes.append(f"Farthest home is about {jround(travel)} ft from a stair (limit ~{A['maxTravelFt']} ft)")
    if sep < req:
        notes.append(f"Stairs about {jround(sep)} ft apart; needs ~{jround(req)} ft: likely a remote stair")
    if retrofit:
        notes.append("No sprinklers on record (CoStar): assume a full sprinkler retrofit" if sprk is False
                     else "Built before 1975: assume a full sprinkler retrofit" if year_known else "Year built unknown: sprinkler retrofit assumed")
    status = "fail" if travel > A["maxTravelFt"] * 1.2 else ("check" if travel > A["maxTravelFt"] or sep < req else "verify")
    stairs = {"lightwell": "Two new stair cores assumed at opposite corners of the courtyard",
              "given": "Stairs assumed at opposite corners of the measured core"}.get(
        L["coreBasis"], "Core position and size assumed (typical central core); stairs assumed at its corners")
    return {"travel": travel, "sep": sep, "req": req, "retrofit": retrofit, "status": status, "notes": notes,
            "coreBasis": L["coreBasis"], "assumed": [stairs], "measured": [f"Floor plate {b.W} x {b.D} ft"]
            + (["Core rectangle"] if L["coreBasis"] == "given" else [])
            + ([f"Sprinklers: {'yes' if sprk else 'none'} (CoStar)"] if sprk is not None else [])}


# ---- Daylight X-ray (mirrors LW.wallAngle / LW.daylight in engine.js) ----
def day_on(b: Building, S) -> bool:
    return S.get("neighbours", True) is not False and bool(b.day and b.day.get("prof"))


def wall_angle(b: Building, L, un, f, f2f, floors):
    z = (f - 1) * f2f + DAY["eyeFt"]
    if un["court"]:
        c = L["court"]
        across = c[3] - c[1] if un["win"] in ("n", "s") else c[2] - c[0]
        return max(0, jround(math.atan2(floors * f2f - z, across) * 180 / math.pi * 10) / 10)
    prof = b.day["prof"].get(un["win"]) or []
    i = math.floor(z / (b.day.get("dz") or 10))
    return prof[max(0, min(len(prof) - 1, i))] if prof else 0


def daylight(b: Building, L, floors, f2f, S):
    if not day_on(b, S):
        return None
    lim = S["dayLim"] if S.get("dayLim") is not None else DAY["lim"]
    walls, by_floor, mix = {}, [], [0, 0, 0]
    opened = open_area = total = 0
    for f in range(2, floors + 1):
        o = 0
        for un in L["units"]:
            total += 1
            if wall_angle(b, L, un, f, f2f, floors) <= lim:
                o += 1
                open_area += un["a"]
                mix[un["t"]] += 1
                continue
            k = "court" if un["court"] else un["win"]
            w = walls.setdefault(k, {"from": f, "to": f, "homes": 0})
            w["to"] = f
            w["homes"] += 1
        opened += o
        by_floor.append(o)
    return {"lim": lim, "strict": bool(S.get("dayStrict")), "open": opened, "dim": total - opened, "openArea": open_area,
            "mix": mix, "byFloor": by_floor, "walls": walls}


def plan(b: Building, u, lw, A, S=None):
    S = {**DEFAULT_CONSTRAINTS, **(S or {})}
    L = layout(b.W, b.D, u, lw, b.core)
    fu = b.floors - 1
    year = b.year if b.year is not None else A["unknownYear"]
    per_floor = len(L["units"])
    day = daylight(b, L, b.floors, b.f2f, S)
    homes = day["open"] if day and day["strict"] else per_floor * fu
    daylit = sum(x["a"] for x in L["units"])
    court_a = area(L["court"]) if L["court"] else 0
    solid_a = union_area(L["cores"] + ([L["court"]] if L["court"] else []))
    net = b.W * b.D - solid_a
    gsf = (b.W * b.D - court_a) * fu
    safe = safety(b, L, A)
    cost = (gsf * A["costPerSqft"] + (gsf * A["abatement"] if year < 1980 else 0)
            + (court_a * fu * A["lightwellPerSqft"] if lw else 0) + (gsf * A["sprinklerPerSqft"] if safe["retrofit"] else 0))
    return {
        "L": L, "lw": lw, "perFloor": per_floor, "homes": homes, "day": day,
        "daylitFrac": clamp((day["openArea"] / (net * fu) if fu > 0 else 0) if day else daylit / net, 0, 1) if net > 0 else 0,
        "gsf": gsf, "cost": cost, "cpu": cost / homes if homes else math.inf,
        "mix": day["mix"] if day and day["strict"] else [sum(1 for x in L["units"] if x["t"] == t) * fu for t in range(3)],
        "safety": safe, "carbon": gsf * 0.0929 * A["carbonKgPerM2"] * A["reuseSaving"] / 1000,
    }


def analyze(b: Building, S=None, A=None) -> Building:
    S = {**DEFAULT_CONSTRAINTS, **(S or {})}
    A = {**DEFAULT_ASSUMPTIONS, **(A or {})}
    p0 = plan(b, S["u"], False, A, S)
    ok = court_ok(b, S["u"])
    p1 = plan(b, S["u"], True, A, S) if ok else None
    p = p0
    if b.forceLW is True and p1:
        p = p1
    elif b.forceLW is None and S["allowLW"] and p1 and p1["cpu"] < p0["cpu"]:
        p = p1
    b.alt = p1 if p is p0 else p0
    b.plan, b.courtOK = p, ok
    obs = [] if S.get("useParking") is False else list(b.obs or [])
    obs_avg = sum(obs) / len(obs) if obs else None
    assumed = []
    if b.rep is not None and obs:
        vac, basis = 1 - (0.35 * b.rep + 0.65 * obs_avg), "leasing + parking"
    elif b.rep is not None:
        vac, basis = 1 - b.rep, "leasing only"
    elif obs:
        vac, basis = 1 - obs_avg, "parking only"
    else:
        vac, basis = A["unknownVacancy"], "assumed"
        assumed.append(f"No leasing or parking evidence: vacancy assumed {jround(A['unknownVacancy'] * 100)}% (Houston average)")
    if b.year is None:
        assumed.append("Year built unknown: costs assume pre-1975 (abatement and sprinklers)")
    cost_score = clamp(1 - (p["cpu"] - 0.6 * S["cap"]) / (0.8 * S["cap"]), 0, 1)
    y = b.year
    age_fit = 0.6 if y is None or y < 1960 else 1 if y <= 1995 else 0.6 if y <= 2008 else 0.25
    safe_score = {"verify": 1, "check": 0.5, "fail": 0}[p["safety"]["status"]]
    b.vac, b.vac_basis, b.assumed = vac, basis, assumed
    b.score = jround(100 * (0.30 * p["daylitFrac"] + 0.26 * vac + 0.20 * cost_score
                            + 0.06 * (1 if b.f2f >= A["f2fMin"] else 0.4) + 0.08 * age_fit + 0.10 * safe_score))
    why = []
    if not p["cpu"] <= S["cap"]:
        why.append("over cost cap")
    if p["homes"] < S["minHomes"]:
        why.append(f"under {S['minHomes']} homes")
    if p["safety"]["status"] == "fail":
        why.append("likely fire-safety blocker")
    if b.f2f < A["f2fHard"]:
        why.append(f"floor-to-floor under {A['f2fHard']} ft")
    missing = [k for k in (S.get("require") or []) if not (b.real or {}).get(k)]
    if missing:
        why.append("missing real " + " + ".join(LAYER_NAME.get(k, k) for k in missing) + " data")
    if b.converted:   # CoStar records the building as converted to another use
        why.append(f"already converted ({b.converted})")
    b.why, b.passes = why, not why
    b.phantom = b.rep is not None and len(obs) >= 2 and b.rep - max(obs) >= 0.45
    return b


def summary(b: Building) -> dict:
    """Compact, JSON-safe view of one analysed building; same shape as LW.summary() in engine.js."""
    p, s = b.plan, b.plan["safety"]
    return {
        "id": b.id, "score": b.score, "passes": b.passes, "why": b.why, "homes": p["homes"],
        "cost_per_home": jround(p["cpu"]) if p["homes"] else None,
        "lightwell": p["lw"], "daylit_pct": jround(p["daylitFrac"] * 100), "homes_per_floor": p["perFloor"],
        "mix": {"studio": p["mix"][0], "one_bed": p["mix"][1], "two_bed": p["mix"][2]},
        "fire_screen": s["status"], "farthest_home_ft": jround(s["travel"]), "stair_sep_ft": jround(s["sep"]), "fire_notes": s["notes"],
        "carbon_t": jround(p["carbon"]), "hidden_vacancy_flag": b.phantom, "vacancy_basis": b.vac_basis, "assumed": b.assumed,
        "dim_homes": p["day"]["dim"] if p["day"] else None, "daylight_rule_deg": p["day"]["lim"] if p["day"] else None,
        "daylight_strict": p["day"]["strict"] if p["day"] else None,
    }


# ---------------- evidence review (mirrors LW.reviewGaps in engine.js) ----------------
# For each value on a shortlisted tower that is estimated, assumed, simulated or missing, try a plausible worse value and
# see whether the decision changes. The agent asks the user to measure only the gaps that would change the decision.
WHATIF = {
    "f2f": {"label": "floor-to-floor height", "unit": "ft", "srcs": ("ESTIMATE", "SIMULATED", "MISSING"),
            "why": "estimated from the building height and floor count", "test": "10 ft"},
    "core": {"label": "core size", "unit": "ft", "srcs": ("ASSUMED", "MISSING"),
             "why": "assumed (typical central core), not measured", "test": "a core 40% larger"},
    "rep": {"label": "percent leased", "unit": "%", "srcs": ("SIMULATED", "MISSING"),
            "why": "not from a CoStar record", "test": "90% leased"},
}


def default_core(W, D):
    cw = min(max(40, jround(W * 0.26 / 10) * 10), W)
    cd = min(max(30, jround(D * 0.2 / 10) * 10), D)
    return [(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2]


def centred_core(W, D, cw, cd):
    cw, cd = min(cw, W), min(cd, D)
    return [(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2]


def what_if(b: Building, f: str) -> Building:
    from dataclasses import replace
    if f == "f2f":
        return replace(b, f2f=min(b.f2f, 10.0))
    if f == "core":
        c = b.core or default_core(b.W, b.D)
        return replace(b, core=centred_core(b.W, b.D, (c[2] - c[0]) * 1.4, (c[3] - c[1]) * 1.4))
    if f == "rep":
        return replace(b, rep=0.9)
    raise ValueError(f)


def current_value(b: Building, f: str) -> str:
    if f == "f2f":
        return f"{b.f2f:g} ft"
    if f == "core":
        c = b.core or default_core(b.W, b.D)
        return f"{jround(c[2] - c[0])} x {jround(c[3] - c[1])} ft"
    return "unknown" if b.rep is None else f"{jround(b.rep * 100)}%"


def review_gaps(buildings: dict, ids, S=None, A=None):
    S = {**DEFAULT_CONSTRAINTS, **(S or {})}
    A = {**DEFAULT_ASSUMPTIONS, **(A or {})}
    ranked = sorted((b for b in buildings.values() if b.passes), key=lambda b: -b.score)
    leader = ranked[0] if ranked else None
    runner = ranked[1] if len(ranked) > 1 else None
    out = []
    for tid in ids:
        b = buildings[tid]
        for f, spec in WHATIF.items():
            src = (b.src or {}).get(f, "MISSING")
            if src not in spec["srcs"]:
                continue
            t = analyze(what_if(b, f), S, A)
            decision = ""
            if b.passes and not t.passes:
                decision = f"would no longer pass ({', '.join(t.why)})"
            elif leader is b and runner is not None and t.score < runner.score:
                decision = f"would drop below {runner.id} ({t.score} vs {runner.score})"
            out.append({"id": tid, "field": f, "label": spec["label"], "unit": spec["unit"], "current": current_value(b, f),
                        "source": src, "basis": spec["why"], "what_if": spec["test"], "score_now": b.score, "score_if": t.score,
                        "passes_if": t.passes, "decision": decision, "relevant": bool(decision)})
    out.sort(key=lambda g: (not g["relevant"], ids.index(g["id"]), -(g["score_now"] - g["score_if"])))
    return out


def parse_measurement(b: Building, f: str, raw):
    """Validate a user-supplied measurement. Returns the engine value or raises ValueError."""
    s = str(raw).strip().lower().replace("ft", "").replace("%", "").strip()
    if f == "f2f":
        v = float(s)
        if not 7 <= v <= 25:
            raise ValueError("floor-to-floor must be 7-25 ft")
        return v
    if f == "rep":
        v = float(s)
        if not 0 <= v <= 100:
            raise ValueError("percent leased must be 0-100")
        return v / 100
    if f == "core":
        parts = [p for p in s.replace("×", "x").replace("*", "x").replace(" ", "").split("x") if p]
        if len(parts) != 2:
            raise ValueError("core size as width x depth, e.g. 60x40")
        cw, cd = float(parts[0]), float(parts[1])
        if not (10 <= cw <= b.W and 10 <= cd <= b.D):
            raise ValueError(f"core must fit inside the {b.W:g} x {b.D:g} ft plate")
        return centred_core(b.W, b.D, cw, cd)
    raise ValueError(f"unknown field {f}")
