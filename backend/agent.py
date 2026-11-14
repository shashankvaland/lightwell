"""Lightwell agent: a deepagents planner with two specialist sub-agents.

Every tool reports what it did through `session.emit(...)`, which the browser receives live (Server-Sent Events).
Without an Anthropic key the same tools run in a fixed order (`run_scripted`), so the demo never depends on the network.
"""
from __future__ import annotations

import json
import os
import queue

from engine import Building, analyze, summary, jround

MODEL = os.environ.get("LIGHTWELL_MODEL", "anthropic:claude-opus-5-5")


class Session:
    def __init__(self, payload: dict):
        self.S = payload.get("constraints") or {}
        self.A = payload.get("assumptions") or {}
        self.prompt = payload.get("prompt", "")
        self.buildings = {b["id"]: Building(**{k: b[k] for k in ("id", "W", "D", "heightM", "floors", "f2f", "year", "rep", "obs", "scanned")},
                                            core=b.get("core"))
                          for b in payload.get("buildings", [])}
        self.real = {b["id"]: b.get("real") or {} for b in payload.get("buildings", [])}
        self.events: queue.Queue = queue.Queue()
        self.top: str | None = None
        self.memo: str | None = None
        self.scored = False

    def src(self, ids, layer: str) -> str:
        """'Real data', '<i>Simulated</i>' or 'n real, m simulated' for the given towers and data layer."""
        n = sum(1 for t in ids if self.real.get(t, {}).get(layer))
        return "<i>Simulated</i>" if n == 0 else ("Real data" if n == len(ids) else f"{n} real, {len(ids) - n} <i>simulated</i>")

    def emit(self, who: str, text: str, ids=None, stage=None):
        self.events.put({"type": "step", "who": who, "text": text, "ids": ids or [], "stage": stage})

    def analyse_all(self):
        for b in self.buildings.values():
            analyze(b, self.S, self.A)
        if not self.scored:
            self.scored = True
            return True
        return False

    def get(self, tid: str) -> Building:
        b = self.buildings.get(tid)
        if b is None:
            raise ValueError(f"Unknown tower id {tid}. Call list_towers first.")
        if b.plan is None:
            analyze(b, self.S, self.A)
        return b


def make_tools(s: Session):
    """Tools are closures over one request's data. Docstrings are what the model reads."""

    def list_towers() -> str:
        """List every candidate office tower (real OpenStreetMap footprints) with id, floors and floor-plate size in feet."""
        rows = [{"id": b.id, "floors": b.floors, "plate_ft": f"{int(b.W)}x{int(b.D)}", "height_m": b.heightM} for b in s.buildings.values()]
        s.emit("Map", f"Listed {len(rows)} real towers 40 m+ with usable floor plates.")
        return json.dumps(rows)

    def get_market_records(tower_ids: list[str]) -> str:
        """CoStar market records (occupancy share leased, year built) for the given tower ids. Real where imported, otherwise simulated."""
        out = {t: {"leased_pct": jround(s.get(t).rep * 100), "year_built": s.get(t).year} for t in tower_ids}
        s.emit("CoStar", f"{s.src(tower_ids, 'market')}: pulled market records for {len(out)} towers.")
        return json.dumps(out)

    def count_parking(tower_ids: list[str]) -> str:
        """Vexcel aerial car counts: share of parking spaces full on each capture date. Real where imported, otherwise simulated."""
        out = {t: [jround(x * 100) for x in s.get(t).obs] for t in tower_ids}
        s.emit("Vexcel", f"{s.src(tower_ids, 'aerial')}: parking counts for {len(out)} towers.")
        return json.dumps(out)

    def read_floor_plates(tower_ids: list[str]) -> str:
        """Matterport floor-plate data: width, depth and floor-to-floor height in feet, and whether a real scan exists."""
        out = {t: {"W": s.get(t).W, "D": s.get(t).D, "f2f": s.get(t).f2f, "scanned": s.get(t).scanned} for t in tower_ids}
        s.emit("Matterport", f"{s.src(tower_ids, 'interior')}: floor plates for {len(out)} towers ({sum(v['scanned'] for v in out.values())} scanned).")
        return json.dumps(out)

    def rank_towers(limit: int = 10) -> str:
        """Run the daylight test, lightwell option, cost model and fire screen on every tower; return the best `limit` by score."""
        first = s.analyse_all()
        bs = sorted(s.buildings.values(), key=lambda b: (not b.passes, -b.score))
        passing = [b for b in bs if b.passes]
        s.emit("Feasibility", f"Ranked all towers: {len(passing)} pass under {money(s.S.get('cap', 300000))} per home; "
               f"lightwells rescue {sum(1 for b in passing if b.plan['lw'])}.", stage="scored" if first else None)
        return json.dumps([summary(b) for b in bs[:limit]])

    def test_conversion(tower_id: str) -> str:
        """Full conversion test for one tower: homes, mix, cost per home, daylight share, lightwell yes/no, carbon avoided."""
        b = s.get(tower_id)
        sm = summary(b)
        s.emit("Feasibility", f"{b.id}: {sm['homes']} homes at {money(sm['cost_per_home'])} each, {sm['daylit_pct']}% daylit"
               f"{', with a lightwell' if sm['lightwell'] else ''}.", ids=[b.id])
        return json.dumps(sm)

    def check_fire_safety(tower_id: str) -> str:
        """Fire-safety screen for one tower: farthest home to a stair, stair separation, sprinkler retrofit need."""
        b = s.get(tower_id)
        sf = b.plan["safety"]
        s.emit("Safety", f"{b.id}: fire screen {sf['status']}; farthest home {jround(sf['travel'])} ft from a stair."
               + (f" {sf['notes'][0]}." if sf["notes"] else ""), ids=[b.id])
        return json.dumps({"status": sf["status"], "farthest_home_ft": jround(sf["travel"]), "notes": sf["notes"]})

    def find_occupancy_mismatches() -> str:
        """Towers whose reported occupancy is far above what aerial parking counts show (possible hidden vacancy)."""
        s.analyse_all()
        flags = [{"id": b.id, "reported_pct": jround(b.rep * 100), "max_parking_pct": jround(max(b.obs) * 100)}
                 for b in s.buildings.values() if b.phantom]
        n_real = sum(1 for f in flags if s.real.get(f["id"], {}).get("market") and s.real.get(f["id"], {}).get("aerial"))
        s.emit("Forensics", f"{len(flags)} hidden-vacancy signals to verify ({n_real} on real data): "
               f"{', '.join(f['id'] for f in flags) or 'none'}.", stage="flags")
        return json.dumps(flags)

    def draft_owner_memo(tower_id: str) -> str:
        """Draft the owner memo for the chosen tower and mark it as the top pick for the user to approve."""
        b = s.get(tower_id)
        sm = summary(b)
        s.top = b.id
        s.memo = (f"{b.id}: {sm['homes']} homes ({sm['mix']['studio']} studio, {sm['mix']['one_bed']} 1-bed, {sm['mix']['two_bed']} 2-bed) "
                  f"at about {money(sm['cost_per_home'])} each; fire screen {sm['fire_screen']}; ~{sm['carbon_t']} t CO2e avoided.")
        s.emit("Planner", f"Drafted the owner memo for {b.id}; waiting for your approval.", ids=[b.id])
        return s.memo

    return dict(list_towers=list_towers, get_market_records=get_market_records, count_parking=count_parking,
                read_floor_plates=read_floor_plates, rank_towers=rank_towers, test_conversion=test_conversion,
                check_fire_safety=check_fire_safety, find_occupancy_mismatches=find_occupancy_mismatches, draft_owner_memo=draft_owner_memo)


def money(n):
    return "—" if n is None else f"${jround(n / 1000)}k"


SYSTEM_PROMPT = """You are Lightwell's planner. You find downtown Houston office towers that can become homes.
Work in this order and keep every step short:
1. list_towers.
2. Ask the market-analyst sub-agent to pull market records and parking counts for all towers and to report occupancy mismatches.
3. Ask the feasibility-engineer sub-agent to rank the towers, then test conversion and fire safety for the top 3.
4. Review: reject any tower that fails the fire screen or is over the cost cap. Prefer higher score, then lower cost per home.
5. Call draft_owner_memo for your single best tower.
Finish with two sentences: the pick and why. Some market and aerial values may be simulated; the tool output says which. Say so if you cite simulated values."""


def run_llm(s: Session):
    from deepagents import create_deep_agent  # imported lazily: the scripted path needs no LLM packages

    t = make_tools(s)
    market = {"name": "market-analyst", "description": "Pulls CoStar market records and Vexcel parking counts; finds occupancy mismatches.",
              "system_prompt": "Use your tools on the tower ids you are given. Return a short factual summary.",
              "tools": [t["get_market_records"], t["count_parking"], t["find_occupancy_mismatches"]]}
    feas = {"name": "feasibility-engineer", "description": "Reads floor plates, ranks towers, tests conversion and fire safety.",
            "system_prompt": "Use rank_towers first, then test_conversion and check_fire_safety on the towers you are asked about. Be brief.",
            "tools": [t["read_floor_plates"], t["rank_towers"], t["test_conversion"], t["check_fire_safety"]]}
    agent = create_deep_agent(model=MODEL, tools=[t["list_towers"], t["rank_towers"], t["draft_owner_memo"]],
                              system_prompt=SYSTEM_PROMPT, subagents=[market, feas])
    s.emit("Planner", f"Planning with {MODEL.split(':')[-1]} (deepagents).")
    result = agent.invoke({"messages": [{"role": "user", "content": s.prompt}]})
    msgs = result.get("messages", []) if isinstance(result, dict) else []
    final = getattr(msgs[-1], "content", "") if msgs else ""
    if isinstance(final, list):
        final = " ".join(p.get("text", "") for p in final if isinstance(p, dict))
    if final:
        s.emit("Planner", str(final)[:600])
    if not s.top:   # the model forgot to pick: fall back to the best ranked tower
        run_pick(s, t)


def run_pick(s: Session, t):
    s.analyse_all()
    best = sorted([b for b in s.buildings.values() if b.passes], key=lambda b: -b.score)
    if best:
        t["draft_owner_memo"](best[0].id)


def run_scripted(s: Session):
    """Same tools, fixed order. Used when no Anthropic key is configured."""
    t = make_tools(s)
    s.emit("Planner", "No Anthropic key set: running Lightwell's fixed plan with the same tools.")
    ids = list(s.buildings)
    t["list_towers"]()
    t["get_market_records"](ids)
    t["count_parking"](ids)
    t["read_floor_plates"](ids)
    top = json.loads(t["rank_towers"](5))
    for row in [r for r in top if r["passes"]][:3]:
        t["test_conversion"](row["id"])
        t["check_fire_safety"](row["id"])
    t["find_occupancy_mismatches"]()
    s.emit("Review", "Rejected towers that fail the fire screen or exceed the cap; kept the highest score.")
    run_pick(s, t)
