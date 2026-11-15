"""Engine tests: geometry invariants on every real tower, worked examples, and JS/Python parity.

    node tests/parity.mjs        # writes tests/js_results.json from the browser engine
    python -m pytest tests -q
"""
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from engine import Building, analyze, area, check_layout, layout, summary, union_area  # noqa: E402

JS = ROOT / "tests" / "js_results.json"


def mk(**kw):
    base = dict(id="T", W=120, D=80, heightM=100, floors=25, f2f=13, year=1980, rep=0.7, obs=[0.5, 0.5, 0.5], scanned=False)
    base.update(kw)
    return Building(**base)


def test_union_area_counts_overlap_once():
    assert union_area([[0, 0, 10, 10], [5, 5, 15, 15]]) == 175
    assert union_area([[0, 0, 10, 10], [0, 0, 10, 10]]) == 100
    assert union_area([]) == 0


@pytest.mark.parametrize("W,D", [(120, 80), (170, 170), (200, 120), (300, 260), (90, 55), (60, 60)])
@pytest.mark.parametrize("u", [25, 30, 35, 40])
@pytest.mark.parametrize("lw", [False, True])
def test_layout_has_no_overlaps(W, D, u, lw):
    wing = 2 * u + 6
    if lw and not (W - 2 * wing >= 30 and D - 2 * wing >= 30):
        pytest.skip("too small for a lightwell")
    L = layout(W, D, u, lw)
    assert check_layout(L, W, D) == []


def test_reviewer_cases():
    # 120 x 80: previously four homes overlapped the core
    L = layout(120, 80, 30, False)
    assert check_layout(L, 120, 80) == []
    assert all(u["r"][3] - u["r"][1] >= 14 for u in L["units"])
    # 170 x 170 with a lightwell: previously the two generated cores overlapped each other
    L = layout(170, 170, 30, True)
    assert check_layout(L, 170, 170) == [] and len(L["cores"]) == 2


def test_scanned_core_is_respected():
    core = [40, 20, 80, 60]
    L = layout(120, 80, 30, False, core)
    assert L["coreBasis"] == "given" and check_layout(L, 120, 80) == []


def test_missing_values_stay_missing_with_explicit_assumption():
    b = analyze(mk(rep=None, year=None, obs=[]))
    assert b.vac_basis == "assumed" and not b.phantom
    assert any("vacancy assumed" in a for a in b.assumed) and any("Year built unknown" in a for a in b.assumed)


def test_brief_min_homes_and_parking():
    b = analyze(mk(), {"minHomes": 10_000})
    assert not b.passes and "under 10000 homes" in b.why
    b = analyze(mk(rep=0.9, obs=[0.1, 0.1, 0.1]))
    assert b.phantom
    b = analyze(mk(rep=0.9, obs=[0.1, 0.1, 0.1]), {"useParking": False})
    assert not b.phantom and b.vac_basis == "leasing only"


def test_required_coverage():
    b = analyze(mk(), {"require": ["interior"]})
    assert not b.passes and any("Matterport" in w for w in b.why)


def test_fire_status_is_preliminary():
    b = analyze(mk())
    assert b.plan["safety"]["status"] in ("verify", "check", "fail")
    assert b.plan["safety"]["assumed"]


@pytest.mark.skipif(not JS.exists(), reason="run `node tests/parity.mjs` first")
def test_js_python_parity():
    data = json.loads(JS.read_text())
    n = 0
    for sc in data:
        for row in sc["rows"]:
            b = analyze(Building(**row["input"]), sc["S"], sc["A"])
            py, js = summary(b), row["summary"]
            for k, v in js.items():
                pv = py[k]
                if isinstance(v, float):
                    assert math.isclose(pv, v, rel_tol=1e-9), (row["input"]["id"], k, pv, v)
                else:
                    assert pv == v, (row["input"]["id"], k, pv, v)
            assert check_layout(b.plan["L"], b.W, b.D) == []
            n += 1
    assert n > 100


@pytest.mark.skipif(not JS.exists(), reason="run `node tests/parity.mjs` first")
def test_fast_track_and_moves_parity():
    from shuffle import challenge_plan, fast_track, plan_moves
    data = json.loads(JS.read_text())
    moved = 0
    for sc in data:
        bs = [analyze(Building(**row["input"]), sc["S"], sc["A"]) for row in sc["rows"]]
        for b, row in zip(bs, sc["rows"]):
            assert fast_track(b) == row["fastTrack"], b.id
            for goal in ("fast", "empty"):
                assert plan_moves(b, bs, goal, sc["A"]) == row["moves"][goal], (b.id, goal)
            assert challenge_plan(b, row["moves"]["fast"], bs) == row["challenge"], b.id
            moved += len((row["moves"]["fast"] or {}).get("moves", []))
    assert moved > 10


def test_moves_free_enough_floors_and_never_target_self():
    from shuffle import fast_track, plan_moves
    data = json.loads(JS.read_text()) if JS.exists() else None
    if not data:
        pytest.skip("run `node tests/parity.mjs` first")
    sc = data[0]
    bs = [analyze(Building(**row["input"]), sc["S"], sc["A"]) for row in sc["rows"]]
    for b in bs:
        ft, p = fast_track(b), plan_moves(b, bs, "fast", sc["A"])
        if p is None:
            continue
        assert all(m["to"] != b.id for m in p["moves"])
        if ft["status"] == "shuffle" and not p["unplaced"]:
            assert p["fast_track_after"] and ft["free"] + p["freed_floors"] >= ft["need"]


# ---------------- Daylight X-ray ----------------
def prof(e_deg=0.0, e_below_ft=0, others=0.0, top_ft=400, dz=10):
    """Synthetic profile: the east wall sees e_deg below e_below_ft, open above; other walls see `others`."""
    n = top_ft // dz + 1
    east = [e_deg if i * dz < e_below_ft else 0.0 for i in range(n)]
    return {"dz": dz, "prof": {"n": [others] * n, "s": [others] * n, "w": [others] * n, "e": east},
            "face": {"n": 0, "s": 180, "e": 90, "w": 270}, "blk": {"n": None, "s": None, "w": None, "e": None}}


def test_neighbour_dims_only_floors_below_its_roof():
    # 25 floors at 13 ft: eye height on floor f = (f - 1) * 13 + 6.5. Below 100 ft is floors 2..8.
    b = analyze(mk(day=prof(e_deg=40, e_below_ft=100)))
    d = b.plan["day"]
    assert set(d["walls"]) == {"e"} and d["walls"]["e"]["from"] == 2 and d["walls"]["e"]["to"] == 8
    east_homes = sum(1 for u in b.plan["L"]["units"] if u["win"] == "e")
    assert d["dim"] == east_homes * 7
    assert b.plan["homes"] == len(b.plan["L"]["units"]) * 24            # score mode: homes still count
    strict = analyze(mk(day=prof(e_deg=40, e_below_ft=100)), {"dayStrict": True})
    assert strict.plan["homes"] == b.plan["homes"] - d["dim"]           # strict mode: dim homes drop out


def test_limit_is_inclusive_and_adjustable():
    b = analyze(mk(day=prof(e_deg=25, e_below_ft=1000)))
    assert b.plan["day"]["dim"] == 0                                     # exactly at the limit counts as open
    b = analyze(mk(day=prof(e_deg=25, e_below_ft=1000)), {"dayLim": 20})
    assert b.plan["day"]["dim"] > 0


def test_lightwell_court_is_dark_low_and_open_high():
    b = analyze(mk(W=200, D=200, floors=30, f2f=13, forceLW=True, day=prof()))
    w = b.plan["day"]["walls"]["court"]
    assert b.plan["lw"] and w["from"] == 2 and w["to"] < 30              # top floors of the court see the sky


def test_off_switch_and_missing_data_change_nothing():
    on = summary(analyze(mk(day=prof(e_deg=60, e_below_ft=400))))
    off = summary(analyze(mk(day=prof(e_deg=60, e_below_ft=400)), {"neighbours": False}))
    none = summary(analyze(mk()))
    assert off == none and off["dim_homes"] is None
    assert on["dim_homes"] > 0 and on["daylit_pct"] < none["daylit_pct"]


DAYLIGHT = ROOT / "lightwell" / "data" / "daylight.json"


@pytest.mark.skipif(not DAYLIGHT.exists(), reason="run `python backend/daylight.py` first")
def test_daylight_file_is_well_formed():
    data = json.loads(DAYLIGHT.read_text())
    assert data["version"] == 1 and data["buildings"]
    for rec in data["buildings"].values():
        assert set(rec["prof"]) == {"n", "s", "e", "w"} and rec["dz"] > 0
        for k, p in rec["prof"].items():
            assert p and all(0 <= a <= 90 for a in p), k
            assert 0 <= rec["face"][k] < 360


# ---------------- Real CoStar data: sprinklers, converted buildings, shared floors, unknown lease ends ----------------
def test_costar_sprinkler_record_overrides_the_year_rule():
    old_with = analyze(mk(year=1962, sprinklers=True))
    assert not old_with.plan["safety"]["retrofit"]                            # 1962 but sprinklered: no retrofit cost
    new_without = analyze(mk(year=1984, sprinklers=False))
    sf = new_without.plan["safety"]
    assert sf["retrofit"] and any("No sprinklers on record (CoStar)" in n for n in sf["notes"])
    unknown = analyze(mk(year=1962))
    assert unknown.plan["safety"]["retrofit"] and summary(analyze(mk(year=1962, sprinklers=None))) == summary(unknown)
    assert old_with.plan["cost"] < analyze(mk(year=1962)).plan["cost"]        # the sprinkler retrofit is no longer priced in


def test_converted_building_never_passes():
    b = analyze(mk(converted=2022))
    assert not b.passes and "already converted (2022)" in b.why
    assert analyze(mk()).why == [w for w in b.why if not w.startswith("already converted")]


def _tower(**kw):
    from shuffle import tenants_of  # noqa: F401  (imported for its module: plan_moves needs it)
    base = dict(id="HOU-99", W=120, D=80, heightM=60, floors=10, f2f=13, year=1980, rep=0.6, obs=[], scanned=False,
                vacantFloors=[2, 3], src={"vacant": "COSTAR"}, center=[-95.36, 29.75])
    base.update(kw)
    return analyze(Building(**base))


def test_a_shared_floor_is_freed_only_when_every_tenant_moves():
    from shuffle import plan_moves
    t = _tower(tenants=[{"name": "A", "floors": [4], "sqft": 5000, "lease_end": 2027, "src": "COSTAR"},
                        {"name": "B", "floors": [4], "sqft": 4000, "lease_end": 2031, "src": "COSTAR"},
                        {"name": "C", "floors": [5], "sqft": 9000, "lease_end": 2028, "src": "COSTAR"}])
    r = _tower(id="HOU-98", vacantFloors=[2, 3, 4, 5, 6, 7, 8, 9], center=[-95.361, 29.751])
    p = plan_moves(t, [t, r], "empty")
    assert p["want"] == 2 and p["freed_floors"] == 2                           # floors 4 and 5, not 3 tenant-floors
    one = plan_moves(t, [t, r], "fast")                                        # needs 7 - 2 = 5 floors; only 2 exist
    assert one["freed_floors"] == 2 and [m["tenant"] for m in one["moves"]] == ["A", "C", "B"]


def test_unknown_lease_ends_go_last_cost_the_assumption_and_are_flagged():
    from shuffle import challenge_plan, plan_moves
    t = _tower(tenants=[{"name": "Known", "floors": [4], "sqft": 1000, "lease_end": 2030, "src": "COSTAR"},
                        {"name": "Unknown", "floors": [5], "sqft": 1000, "lease_end": None, "src": "COSTAR"}])
    r = _tower(id="HOU-98", vacantFloors=[2, 3, 4, 5, 6, 7, 8, 9], center=[-95.361, 29.751])
    p = plan_moves(t, [t, r], "empty", {"unknownLeaseYrs": 3})
    assert [m["tenant"] for m in p["moves"]] == ["Known", "Unknown"]
    unk = next(m for m in p["moves"] if m["tenant"] == "Unknown")
    assert unk["lease_end"] is None and unk["buyout_years"] == 3 and unk["cost"] == 1000 * (15 + 30 * 3)
    risks = [x["text"] for x in challenge_plan(t, p, [t, r])["risks"]]
    assert any("1 tenant(s) have no lease end on record" in x for x in risks)
    assert not any("simulated" in x for x in risks)                           # real CoStar tenants are not called simulated


# ---------------- Data scout ----------------
def test_scout_parity_and_honesty():
    from scout import data_priority, scout_gaps
    p = ROOT / "tests" / "js_scout.json"
    if not p.exists():
        pytest.skip("run node tests/parity.mjs first")
    d = json.loads(p.read_text())
    bs = [analyze(Building(**row), d["S"], d["A"]) for row in d["input"]]
    est = scout_gaps(bs)
    assert est == d["estimates"]
    assert est and all(e["lo"] <= e["value"] <= e["hi"] for e in est)
    gaps = {b.id for b in bs if b.src["rep"] == "MISSING"}
    assert {e["id"] for e in est} == gaps                     # fills only real gaps, never CoStar or simulated values
    by = {b.id: b for b in bs}
    for e in est:
        by[e["id"]].rep, by[e["id"]].src["rep"] = e["value"], "ESTIMATE"
    for b in bs:
        analyze(b, d["S"], d["A"])
    pri = data_priority(bs, d["S"], d["A"], 8)
    assert pri == d["priority"]
    assert all(by[x["id"]].src["rep"] not in ("COSTAR", "YOU") for x in pri)


def test_estimate_still_fails_require_real():
    from scout import apply_estimates, scout_gaps
    a = mk(id="A", rep=0.6, src={"rep": "COSTAR"}, center=[-95.3665, 29.7575], real={"market": True})
    b = mk(id="B", rep=None, src={"rep": "MISSING"}, center=[-95.3660, 29.7580])
    est = scout_gaps([a, b])
    assert [e["id"] for e in est] == ["B"] and 0.6 <= est[0]["value"] <= 0.748
    apply_estimates({"A": a, "B": b}, est)
    assert b.src["rep"] == "ESTIMATE"
    S = {"require": ["market"]}
    assert "missing real CoStar data" in analyze(b, S).why
