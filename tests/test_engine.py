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
