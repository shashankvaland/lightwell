"""Lightwell agent: a deepagents planner with two specialist sub-agents and a review-and-replan loop.

Every tool reports what it did through `session.emit(...)`, which the browser receives live (Server-Sent Events).
`request_measurement` pauses the run and asks the user in the browser for one measurement; the answer comes back
through POST /api/answer and the agent re-ranks and explains what changed.
Without an Anthropic key the same tools run in a fixed order (`run_scripted`), so the demo never depends on the network.

The market / aerial / interior tools read the values the browser sent: CoStar, Vexcel and Matterport records imported
with backend/import_data.py (tagged per field), or simulated stand-ins in demo mode. They do not call the sponsor APIs live.
"""
from __future__ import annotations

import json
import os
import queue
import uuid

from engine import clamp as clamp_
from rent import RENT_LABEL, rent_check
from scout import SC as SCOUT, apply_estimates, data_priority, scout_gaps
from shuffle import FT_LABEL, P as POLICY, challenge_plan as _challenge, fast_track, plan_moves, tenants_of
from engine import (SAFE_LABEL, Building, LAYER_NAME, WHATIF, analyze, current_value, jround, parse_measurement, review_gaps, summary)

MODEL = os.environ.get("LIGHTWELL_MODEL", "anthropic:claude-opus-5-5")
ASK_TIMEOUT_S = int(os.environ.get("LIGHTWELL_ASK_TIMEOUT", "300"))
FIELDS = ("id", "W", "D", "heightM", "floors", "f2f", "year", "rep", "obs", "scanned", "core", "forceLW", "real", "src", "vacantFloors", "center", "tenants", "day",
          "sprinklers", "converted", "rentMarket")
BRIEF_KEYS = ("u", "cap", "allowLW", "minHomes", "useParking", "require", "neighbours", "dayLim", "dayStrict")


class Session:
    def __init__(self, payload: dict):
        self.id = uuid.uuid4().hex[:12]
        self.S = {"u": 30, "cap": 300000, "allowLW": True, "minHomes": 20, "useParking": True, "require": [],
                  "neighbours": True, "dayLim": 25, "dayStrict": False, **(payload.get("constraints") or {})}
        self.A = payload.get("assumptions") or {}
        self.prompt = payload.get("prompt", "")
        self.key = payload.get("key")        # the browser's fingerprint of the inputs; echoed back with the result
        self.buildings = {b["id"]: Building(**{k: b.get(k) for k in FIELDS if k in b}) for b in payload.get("buildings", [])}
        for b in self.buildings.values():
            b.obs, b.real, b.src = b.obs or [], b.real or {}, b.src or {}
            b.vacantFloors = b.vacantFloors or []
        self.events: queue.Queue = queue.Queue()
        self.answers: dict[str, queue.Queue] = {}
        self.corrections: dict[str, dict] = {}
        self.top: str | None = None
        self.memo: str | None = None
        self.review: list[str] = []
        self.first_rank: list[str] | None = None
        self.scored = False
        self.asked = 0
        self.moves: dict | None = None
        self.challenge: dict | None = None
        self.estimates: list = []
        self.answer: dict | None = None
        self.question = payload.get("question", "")
        self.history = payload.get("history") or []

    # ---- helpers ----
    def src(self, ids, layer: str) -> str:
        n = sum(1 for t in ids if self.buildings[t].real.get(layer))
        return "<i>Simulated or missing</i>" if n == 0 else ("Imported real data" if n == len(ids) else f"{n} imported real, {len(ids) - n} <i>simulated or missing</i>")

    def emit(self, who: str, text: str, ids=None, stage=None):
        self.events.put({"type": "step", "who": who, "text": text, "ids": ids or [], "stage": stage})

    def analyse_all(self):
        for b in self.buildings.values():
            analyze(b, self.S, self.A)
        first = not self.scored
        self.scored = True
        return first

    def ranked(self):
        return sorted(self.buildings.values(), key=lambda b: (not b.passes, -b.score))

    def get(self, tid: str) -> Building:
        b = self.buildings.get(tid)
        if b is None:
            raise ValueError(f"Unknown tower id {tid}. Call list_towers first.")
        if b.plan is None:
            analyze(b, self.S, self.A)
        return b

    def result(self) -> dict:
        self.analyse_all()
        return {"type": "done", "top": self.top, "memo": self.memo, "key": self.key, "brief": self.S, "review": self.review,
                "corrections": self.corrections, "moves": self.moves, "challenge": self.challenge, "estimates": self.estimates, "reviewed": summary(self.buildings[self.top]) if self.top else None,
                "results": {b.id: summary(b) for b in self.buildings.values()}}


def big_money(n):
    return "—" if n is None else (f"${jround(n / 1e5) / 10:g}M" if n >= 1e6 else f"${jround(n / 1000)}k")


COMPASS = ("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west")


def compass_name(deg):
    """Compass word for a bearing in degrees (0 = north), e.g. 305 -> 'north-west'. Mirrors LW.compass in engine.js."""
    return COMPASS[jround(deg / 45) % 8] if deg is not None else "unknown"


def money(n):
    return "—" if n is None else f"${jround(n / 1000)}k"


def make_tools(s: Session):
    """Tools are closures over one request's data. Docstrings are what the model reads."""

    def list_towers() -> str:
        """List every candidate office tower (real OpenStreetMap footprints) with id, floors and floor-plate size in feet."""
        rows = [{"id": b.id, "floors": b.floors, "plate_ft": f"{int(b.W)}x{int(b.D)}", "height_m": b.heightM} for b in s.buildings.values()]
        s.emit("Map", f"Listed {len(rows)} real towers 40 m+ with usable floor plates.")
        return json.dumps(rows)

    def get_brief() -> str:
        """The current screening brief: u (max ft from a window), cap ($ per home), allowLW, minHomes, useParking, require (real data layers)."""
        return json.dumps(s.S)

    def update_brief(max_cost_per_home: int | None = None, min_homes: int | None = None, window_ft: int | None = None,
                     allow_lightwell: bool | None = None, use_parking: bool | None = None,
                     require_real: list[str] | None = None, strict_daylight: bool | None = None,
                     daylight_limit_deg: int | None = None, reason: str = "") -> str:
        """Change the screening brief when the user's request (or a later instruction) asks for it. Only pass what changes.
        max_cost_per_home: 100000-600000. min_homes: 1-5000. window_ft: 20-45. require_real: any of 'market', 'aerial', 'interior'.
        use_parking=False ignores aerial parking evidence in scoring and flags. strict_daylight=True stops counting homes whose
        windows face a nearby building (otherwise they only lower the daylight score). daylight_limit_deg: 20-35.
        Always give a short reason quoting the user."""
        new, errors = dict(s.S), []
        if max_cost_per_home is not None:
            (new.__setitem__("cap", int(max_cost_per_home)) if 100000 <= max_cost_per_home <= 600000 else errors.append("cap out of range"))
        if min_homes is not None:
            (new.__setitem__("minHomes", int(min_homes)) if 1 <= min_homes <= 5000 else errors.append("min_homes out of range"))
        if window_ft is not None:
            (new.__setitem__("u", int(window_ft)) if 20 <= window_ft <= 45 else errors.append("window_ft out of range"))
        if allow_lightwell is not None:
            new["allowLW"] = bool(allow_lightwell)
        if strict_daylight is not None:
            new["dayStrict"] = bool(strict_daylight)
        if daylight_limit_deg is not None:
            (new.__setitem__("dayLim", int(daylight_limit_deg)) if 20 <= daylight_limit_deg <= 35 else errors.append("daylight_limit_deg out of range"))
        if use_parking is not None:
            new["useParking"] = bool(use_parking)
        if require_real is not None:
            bad = [k for k in require_real if k not in LAYER_NAME]
            new["require"] = [k for k in require_real if k in LAYER_NAME]
            if bad:
                errors.append(f"unknown layers {bad}")
        changed = {k: new[k] for k in BRIEF_KEYS if new[k] != s.S.get(k)}
        s.S = new
        if changed:
            s.analyse_all()
            s.events.put({"type": "brief", "brief": s.S, "reason": reason})
            s.emit("Planner", f"Updated the brief ({', '.join(f'{k}={v}' for k, v in changed.items())}){': ' + reason if reason else ''}.")
        return json.dumps({"brief": s.S, "changed": changed, "errors": errors})

    def get_market_records(tower_ids: list[str]) -> str:
        """CoStar market records (share leased, year built) with a source tag per value: COSTAR, SIMULATED, MISSING or YOU."""
        out = {t: {"leased_pct": None if s.get(t).rep is None else jround(s.get(t).rep * 100), "leased_src": s.get(t).src.get("rep"),
                   "year_built": s.get(t).year, "year_src": s.get(t).src.get("year")} for t in tower_ids}
        s.emit("CoStar", f"{s.src(tower_ids, 'market')}: market records for {len(out)} towers.")
        return json.dumps(out)

    def count_parking(tower_ids: list[str]) -> str:
        """Vexcel aerial car counts: share of parking spaces full on each capture date, with source tag."""
        out = {t: {"pct_full": [jround(x * 100) for x in s.get(t).obs], "src": s.get(t).src.get("obs")} for t in tower_ids}
        s.emit("Vexcel", f"{s.src(tower_ids, 'aerial')}: parking counts for {len(out)} towers."
               + ("" if s.S.get("useParking", True) else " The brief says to ignore parking, so it won't affect the ranking."))
        return json.dumps(out)

    def read_floor_plates(tower_ids: list[str]) -> str:
        """Floor-plate data: width, depth, floor-to-floor height (ft), core rectangle, each with its source tag (MATTERPORT, OSM, ESTIMATE, ASSUMED)."""
        out = {t: {"W": s.get(t).W, "D": s.get(t).D, "plate_src": s.get(t).src.get("plate"), "f2f": s.get(t).f2f,
                   "f2f_src": s.get(t).src.get("f2f"), "core": s.get(t).core, "core_src": s.get(t).src.get("core")} for t in tower_ids}
        s.emit("Matterport", f"{s.src(tower_ids, 'interior')}: floor plates for {len(out)} towers.")
        return json.dumps(out)

    def rank_towers(limit: int = 10) -> str:
        """Run the daylight test, lightwell option, cost model and preliminary fire screen on every tower under the
        current brief; return the best `limit` (passing towers first, then by score) with reasons for any that fail."""
        first = s.analyse_all()
        bs = s.ranked()
        passing = [b for b in bs if b.passes]
        if s.first_rank is None:
            s.first_rank = [b.id for b in passing]
        s.emit("Feasibility", f"Ranked all towers: {len(passing)} pass under {money(s.S['cap'])} per home"
               f"{' with ' + str(s.S['minHomes']) + '+ homes' if s.S['minHomes'] != 20 else ''}; "
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
        """Preliminary fire screen for one tower (an estimate, not a code review): 'verify' = no blocker found but needs
        verification, 'check' = design work likely, 'fail' = likely blocker. Lists what is assumed."""
        b = s.get(tower_id)
        sf = b.plan["safety"]
        label = {"verify": "no blocker found, needs verification", "check": "design work likely", "fail": "likely blocker"}[sf["status"]]
        s.emit("Safety", f"{b.id}: preliminary fire screen: {label}; farthest home about {jround(sf['travel'])} ft from a stair."
               + (f" {sf['notes'][0]}." if sf["notes"] else ""), ids=[b.id])
        return json.dumps({"status": sf["status"], "farthest_home_ft": jround(sf["travel"]), "notes": sf["notes"], "assumed": sf["assumed"]})

    def check_daylight(tower_ids: list[str]) -> str:
        """Daylight X-ray for each tower: how many homes have windows facing a nearby building (obstruction angle above the
        brief's limit, default 25 degrees), which walls and floors, and the main blocking building. A screening check, not
        a daylight study. In strict mode those homes are not counted."""
        out = {}
        for t in tower_ids:
            b = s.get(t)
            d = b.plan.get("day")
            if not d:
                out[t] = {"checked": False, "why": "no neighbour data for this tower" if s.S.get("neighbours", True) else "switched off in the brief"}
                continue
            walls = []
            for k, w in sorted(d["walls"].items(), key=lambda kv: -kv[1]["homes"]):
                blk = (b.day.get("blk") or {}).get(k) if k != "court" else None
                walls.append({"wall": k, "faces_deg": (b.day.get("face") or {}).get(k), "floors": f"{w['from']}-{w['to']}",
                              "dim_homes": w["homes"], "blocker_osm": blk and blk["osm"], "blocker_height_m": blk and blk["h"],
                              "blocker_distance_ft": blk and blk["d"], "height_source": blk and blk["src"]})
            out[t] = {"checked": True, "limit_deg": d["lim"], "strict": d["strict"], "dim_homes": d["dim"],
                      "homes_checked": d["open"] + d["dim"], "walls": walls}
        checked = [t for t in tower_ids if out[t]["checked"]]
        worst = max(checked, key=lambda t: out[t]["dim_homes"] / max(1, out[t]["homes_checked"]), default=None)
        if worst:
            w = out[worst]
            first = w["walls"][0] if w["walls"] else None
            s.emit("Daylight", f"Checked {len(checked)} towers against their neighbours (limit {w['limit_deg']}°). "
                   f"{worst}: {w['dim_homes']} of {w['homes_checked']} homes face a nearby building"
                   + (f", mostly the {'lightwell court' if first['wall'] == 'court' else compass_name(first['faces_deg']) + '-facing wall'} on floors {first['floors']}" if first else "")
                   + (". Strict mode: those homes are not counted." if w["strict"] else "; they lower the daylight score."), ids=[worst])
        else:
            s.emit("Daylight", "No neighbour data for these towers (run backend/daylight.py), so daylight uses the window-distance test only.")
        return json.dumps(out)

    def find_occupancy_mismatches() -> str:
        """Towers whose reported occupancy is far above what aerial parking counts show: observations to investigate, not findings."""
        s.analyse_all()
        flags = [{"id": b.id, "reported_pct": jround(b.rep * 100), "max_parking_pct": jround(max(b.obs) * 100),
                  "real": bool(b.real.get("market") and b.real.get("aerial"))} for b in s.buildings.values() if b.phantom]
        n_real = sum(1 for f in flags if f["real"])
        s.emit("Forensics", ("Parking ignored by the brief: no occupancy comparison." if not s.S.get("useParking", True) else
               f"{len(flags)} occupancy discrepancies to investigate ({n_real} on real data): {', '.join(f['id'] for f in flags) or 'none'}."),
               stage="flags")
        return json.dumps(flags)

    def review_evidence(tower_ids: list[str]) -> str:
        """Review step. For each shortlisted tower, list values that are estimated, assumed, simulated or missing, and test
        a plausible worse value for each. 'relevant' gaps would change the decision (the tower would fail, or lose first place).
        Ask the user to measure a relevant gap with request_measurement before recommending that tower."""
        s.analyse_all()
        gaps = review_gaps(s.buildings, [t for t in tower_ids if t in s.buildings], s.S, s.A)
        rel = [g for g in gaps if g["relevant"]]
        if rel:
            g = rel[0]
            msg = (f"{g['id']}'s {g['label']} is {g['current']}, {g['basis']}. At {g['what_if']}, {g['id']} {g['decision']}. "
                   f"{len(rel)} decision-relevant gap{'s' if len(rel) != 1 else ''} across the shortlist.")
        else:
            msg = "No missing value would change the shortlist; the remaining estimates are noted in the memo."
        s.review.append(msg)
        s.emit("Review", msg, ids=[rel[0]["id"]] if rel else None)
        return json.dumps(gaps[:8])

    def request_measurement(tower_id: str, field: str, why: str) -> str:
        """Pause and ask the user for one measured value. field: 'f2f' (floor-to-floor ft), 'core' (core width x depth ft)
        or 'rep' (percent leased). why: one sentence on why it matters. Re-ranks with the answer and reports what changed.
        Ask at most twice per run."""
        b = s.get(tower_id)
        if field not in WHATIF:
            return json.dumps({"error": f"field must be one of {list(WHATIF)}"})
        if s.asked >= 2:
            return json.dumps({"error": "already asked twice; recommend with the estimates and say so"})
        s.asked += 1
        ask_id = uuid.uuid4().hex[:8]
        q: queue.Queue = queue.Queue()
        s.answers[ask_id] = q
        spec = WHATIF[field]
        before = [x.id for x in s.ranked() if x.passes]
        s.events.put({"type": "ask", "ask_id": ask_id, "session": s.id, "tower": b.id, "field": field, "label": spec["label"],
                      "unit": spec["unit"], "current": current_value(b, field), "why": why,
                      "placeholder": {"f2f": "e.g. 11.5", "core": "e.g. 60x45", "rep": "e.g. 85"}[field]})
        s.emit("Planner", f"Waiting for you: measured {spec['label']} for {b.id}.", ids=[b.id])
        try:
            raw = q.get(timeout=ASK_TIMEOUT_S)
        except queue.Empty:
            raw = None
        if raw in (None, ""):
            s.emit("Planner", f"No measurement given; keeping the estimate for {b.id} and noting it in the memo.")
            return json.dumps({"answered": False})
        try:
            value = parse_measurement(b, field, raw)
        except ValueError as e:
            s.emit("Planner", f"Couldn't use “{raw}”: {e}. Keeping the estimate.")
            return json.dumps({"answered": False, "error": str(e)})
        old_score, old_pass = b.score, b.passes
        setattr(b, field, value)
        b.src[field] = "YOU"
        s.corrections.setdefault(b.id, {})[field] = value
        s.analyse_all()
        after = [x.id for x in s.ranked() if x.passes]
        shown = f"{raw}{' ft' if field == 'f2f' else '%' if field == 'rep' else ' ft'}"
        change = (f"{b.id}: score {old_score} → {b.score}"
                  + ("" if old_pass == b.passes else (", now fails: " + ", ".join(b.why) if not b.passes else ", now passes"))
                  + f". New leader: {after[0] if after else 'none'}" + (f" (was {before[0]})" if before and after and before[0] != after[0] else ""))
        s.review.append(f"You measured {b.id}'s {spec['label']} at {shown}. {change}.")
        s.emit("Review", f"Re-ranked with your measurement ({shown}). {change}.", ids=[after[0]] if after else [b.id], stage="rescored")
        return json.dumps({"answered": True, "value": raw, "tower": summary(b), "leader_before": before[:3], "leader_after": after[:3]})


    def check_texas_fast_track(tower_ids: list[str]) -> str:
        """Texas SB 840 / SB 2477 screen (in force Sep 2025; Houston qualifies): an office building 5+ years old converts
        without rezoning, traffic studies or extra parking if at least 65% of it becomes homes. For each tower returns
        status ('ready' = enough floors already empty, 'shuffle' = `short` more floors must be freed by moving tenants,
        'too_new', 'unknown' = no floor-by-floor data), floors needed, floors empty now and building age. A screen, not legal advice."""
        s.analyse_all()
        out = {t: fast_track(s.get(t)) for t in tower_ids if t in s.buildings}
        ready = [t for t, v in out.items() if v["status"] == "ready"]
        sh = [t for t, v in out.items() if v["status"] == "shuffle"]
        s.emit("Policy", f"Texas fast-track (SB 840/2477, 65% residential): {len(ready)} ready now"
               f"{' (' + ', '.join(ready[:4]) + ')' if ready else ''}; {len(sh)} need tenant moves"
               + (f", e.g. {sh[0]} needs {out[sh[0]]['short']} more empty floors" if sh else "") + ".", ids=(ready or sh)[:1])
        return json.dumps(out)

    def list_tenants(tower_id: str) -> str:
        """Tenants in one tower from CoStar tenant / lease records (or SIMULATED stand-ins): name, floors, sq ft, lease end year."""
        b = s.get(tower_id)
        ts = tenants_of(b)
        if ts is None:
            return json.dumps({"error": f"No floor-by-floor data for {b.id}."})
        src = "CoStar records" if ts and all(x.get("src") == "COSTAR" for x in ts) else "<i>simulated</i>"
        unk = sum(1 for x in ts if x.get("lease_end") is None)
        s.emit("CoStar", f"{b.id}: {len(ts)} tenants ({src}); "
               f"{sum(1 for x in ts if x.get('lease_end') is not None and x['lease_end'] <= POLICY['year'] + 1)} leases end by {POLICY['year'] + 1}"
               + (f"; {unk} with no lease end on record" if unk else "") + ".", ids=[b.id])
        return json.dumps(ts)

    def plan_tenant_moves(tower_id: str, goal: str = "fast") -> str:
        """Plan tenant moves that free floors in one tower. goal='fast' frees just enough floors to reach the 65% Texas
        fast-track; goal='empty' empties the tower. Picks tenants whose leases end soonest, moves each to the nearest tower
        with room (preferring towers that are poor conversion candidates, so they stay offices and fill up). Returns moves,
        incentive cost (moving allowance + early-exit concessions, estimates), homes unlocked and cost per home unlocked."""
        s.analyse_all()
        b = s.get(tower_id)
        plan = plan_moves(b, list(s.buildings.values()), goal if goal in ("fast", "empty") else "fast", s.A)
        if plan is None:
            return json.dumps({"error": f"No floor-by-floor data for {b.id}; can't plan moves."})
        s.moves, s.challenge = plan, None
        s.events.put({"type": "moves", "plan": plan})
        s.emit("Deals", f"{b.id}: move {len(plan['moves'])} tenants ({plan['freed_floors']} floors) into "
               f"{', '.join(plan['receivers']) or 'no tower'} → {plan['homes_after']} homes can start now (+{plan['homes_gained']}); "
               f"incentives about {big_money(plan['cost'])}"
               + (f", {money(plan['cost_per_home_gained'])} per home unlocked" if plan["cost_per_home_gained"] else "")
               + (". Reaches the fast-track." if plan["fast_track_after"] else ". Still short of the fast-track."), ids=[b.id])
        return json.dumps(plan)

    def challenge_plan(tower_id: str) -> str:
        """Red team: attack the latest tenant-move plan for this tower (long leases, far moves, receivers that are
        themselves conversion candidates, unplaced tenants, unverified age, simulated data). Returns risks and a verdict."""
        s.analyse_all()
        b = s.get(tower_id)
        plan = s.moves if s.moves and s.moves["tower"] == b.id else plan_moves(b, list(s.buildings.values()), "fast", s.A)
        c = _challenge(b, plan, list(s.buildings.values()))
        s.challenge = {**c, "tower": b.id}
        s.events.put({"type": "challenge", "tower": b.id, **c})
        top = [r for r in c["risks"] if r["level"] != "low"]
        s.emit("Red team", f"{b.id}: {dict(holds='plan holds', holds_with_caveats='holds, with caveats', weak='plan is weak', no_plan='no plan possible')[c['verdict']]}."
               + (f" Biggest risk: {top[0]['text']}" if top else " No serious objection.")
               + (f" (+{len(top) - 1} more)" if len(top) > 1 else ""), ids=[b.id])
        return json.dumps(c)

    def draft_owner_memo(tower_id: str, rationale: str = "") -> str:
        """Draft the owner memo for the chosen tower (it must pass the brief) and mark it as the top pick for the user to approve.
        rationale: two sentences on why this tower, naming any estimate that still matters."""
        b = s.get(tower_id)
        if not b.passes:
            return json.dumps({"error": f"{b.id} does not pass the brief ({', '.join(b.why)}). Pick a passing tower."})
        s.top = b.id
        sm = summary(b)
        s.memo = rationale or (f"{b.id}: {sm['homes']} homes at about {money(sm['cost_per_home'])} each; "
                               f"preliminary fire screen: {SAFE_LABEL[sm['fire_screen']].lower()}; ~{sm['carbon_t']} t CO2e avoided."
                               + (f" Tenant moves: {len(s.moves['moves'])} tenants into {', '.join(s.moves['receivers'])} for about "
                                  f"{big_money(s.moves['cost'])} reach the Texas 65% fast-track." if s.moves and s.moves["tower"] == b.id and s.moves["moves"] else ""))
        s.emit("Planner", f"Drafted the owner memo for {b.id}; waiting for your approval.", ids=[b.id])
        return json.dumps({"ok": True, "summary": sm})

    def estimate_missing_data() -> str:
        """Data scout. For towers with NO CoStar record (percent leased MISSING), estimate percent leased from the most
        similar CoStar towers (nearby, similar height), pulled toward the downtown average (25.2% vacant, CBRE Q4 2025).
        Each estimate is tagged ESTIMATE with a low-high range, a confidence and the towers it came from. Never overwrites
        CoStar, user or simulated values; estimated towers still fail 'require real CoStar'. Re-ranks afterwards."""
        est = scout_gaps(list(s.buildings.values()))
        if not est:
            n_sim = sum(1 for b in s.buildings.values() if b.src.get("rep") == "SIMULATED")
            s.emit("Scout", "No gaps to estimate: " + (f"{n_sim} towers use demo (simulated) values; switch to Real data only to estimate from CoStar."
                                                       if n_sim else "every tower has a leasing record."))
            return json.dumps({"estimated": 0})
        apply_estimates(s.buildings, est)
        s.estimates = [e for e in est if e["id"] not in {x["id"] for x in s.estimates}] + s.estimates
        s.events.put({"type": "estimates", "items": est})
        if s.scored:
            s.analyse_all()
        ref = len({n["id"] for e in est for n in e["neighbours"]})
        med = sum(1 for e in est if e["confidence"] == "medium")
        s.emit("Scout", f"{len(est)} towers have no CoStar record. Estimated percent leased from {ref} comparable CoStar towers "
               f"(nearest and most similar in height){', pulled toward the downtown average' if ref else ''}: {med} medium, {len(est) - med} low confidence. "
               "Tagged ESTIMATE; they still don't count as real data.", ids=[est[0]["id"]])
        return json.dumps({"estimated": len(est), "items": [{k: e[k] for k in ("id", "value", "lo", "hi", "confidence", "basis")} for e in est[:15]]})

    def rank_data_requests(limit: int = 5) -> str:
        """Which towers are most worth asking CoStar about next: re-runs the screen at the low and high end of what we
        don't know (occupancy 55-95%, year built 1965 or 2000) and ranks towers where the answer changes the decision
        (pass/fail flips, big score swings, the Texas 65% check needs floor-by-floor availability)."""
        s.analyse_all()
        pri = data_priority(list(s.buildings.values()), s.S, s.A, max(1, min(10, int(limit))))
        if pri:
            s.emit("Scout", f"Ask CoStar next about {', '.join(p['id'] for p in pri[:3])}: {pri[0]['id']} "
                   + "; ".join(pri[0]["reasons"][:2]) + ".", ids=[pri[0]["id"]])
        else:
            s.emit("Scout", "No missing value would change a decision: no CoStar request needed for now.")
        return json.dumps(pri)

    def explain_tower(tower_id: str) -> str:
        """Everything about one tower: the screen result (homes, cost per home, score, pass/fail and why), the value
        and source tag of every input (COSTAR, VEXCEL, MATTERPORT, OSM, ESTIMATE, ASSUMED, SIMULATED, MISSING, YOU),
        assumptions made, and the Texas fast-track status."""
        s.analyse_all()
        b = s.get(tower_id)
        sm = summary(b)
        est = next((e for e in s.estimates if e["id"] == b.id), None)
        rank = [x.id for x in s.ranked()].index(b.id) + 1
        return json.dumps({**sm, "rank": rank, "floors": b.floors, "year_built": b.year, "leased": b.rep, "fast_track": fast_track(b),
                           "sources": b.src, "real_layers": b.real, "estimate": est})

    def compare_towers(tower_ids: list[str]) -> str:
        """Side-by-side comparison of 2-4 towers: score, rank, homes, cost per home, daylight, fire screen, fast-track and data sources."""
        s.analyse_all()
        order = [x.id for x in s.ranked()]
        out = []
        for t in tower_ids[:4]:
            b = s.get(t)
            sm = summary(b)
            out.append({"id": b.id, "rank": order.index(b.id) + 1, "score": sm["score"], "passes": sm["passes"], "why": sm["why"],
                        "homes": sm["homes"], "cost_per_home": sm["cost_per_home"], "daylit_pct": sm["daylit_pct"],
                        "fire_screen": sm["fire_screen"], "fast_track": fast_track(b)["status"],
                        "leased_src": b.src.get("rep"), "year_src": b.src.get("year")})
        return json.dumps(out)

    def preview_brief(max_cost_per_home: int | None = None, min_homes: int | None = None, window_ft: int | None = None,
                      allow_lightwell: bool | None = None) -> str:
        """What-if: which towers would pass under a different brief, WITHOUT changing it. Returns towers that would newly
        pass, stop passing, and the new leader. Use update_brief only if the user asks to apply the change."""
        from engine import analyze as _an
        from dataclasses import replace as _rep
        S2 = dict(s.S)
        if max_cost_per_home is not None:
            S2["cap"] = int(clamp_(max_cost_per_home, 100000, 600000))
        if min_homes is not None:
            S2["minHomes"] = int(clamp_(min_homes, 1, 5000))
        if window_ft is not None:
            S2["u"] = int(clamp_(window_ft, 20, 45))
        if allow_lightwell is not None:
            S2["allowLW"] = bool(allow_lightwell)
        s.analyse_all()
        now = {b.id for b in s.buildings.values() if b.passes}
        alt = {b.id: _an(_rep(b), S2, s.A) for b in s.buildings.values()}
        then = {t for t, b in alt.items() if b.passes}
        lead = max((alt[t] for t in then), key=lambda b: b.score, default=None)
        return json.dumps({"brief": S2, "pass_now": len(now), "pass_then": len(then), "newly_pass": sorted(then - now),
                           "stop_passing": sorted(now - then), "leader_then": lead.id if lead else None})

    def check_rents(tower_ids: list[str]) -> str:
        """Rent check: the monthly rent per home each tower needs to pay back its conversion (cost per home x target
        yield + operating cost, after vacancy), against real asking rents from CoStar listings nearby (median by bedroom
        count, or per sq ft x home size), the cost per home the market supports, and the income needed at 30% of income
        vs Houston's median. verdict: works / close (within 10%) / gap / no_data (no CoStar rents loaded)."""
        s.analyse_all()
        out = {t: rent_check(s.get(t), s.A) for t in tower_ids if t in s.buildings}
        txt = rent_text(s, list(out))
        if txt:
            s.emit("Rent", txt, ids=list(out)[:1])
        return json.dumps(out)

    def answer_user(text: str, tower_ids: list[str] | None = None) -> str:
        """Ask mode only: give the final answer to the user's question. text: plain sentences, short, with numbers and
        source tags. tower_ids: towers to highlight on the map (first one is selected)."""
        s.answer = {"text": text, "ids": [t for t in (tower_ids or []) if t in s.buildings]}
        return json.dumps({"ok": True})

    return dict(check_rents=check_rents, list_towers=list_towers, get_brief=get_brief, estimate_missing_data=estimate_missing_data,
                rank_data_requests=rank_data_requests, explain_tower=explain_tower, compare_towers=compare_towers,
                preview_brief=preview_brief, answer_user=answer_user, update_brief=update_brief, get_market_records=get_market_records,
                count_parking=count_parking, read_floor_plates=read_floor_plates, rank_towers=rank_towers,
                test_conversion=test_conversion, check_fire_safety=check_fire_safety, check_daylight=check_daylight,
                find_occupancy_mismatches=find_occupancy_mismatches, review_evidence=review_evidence,
                request_measurement=request_measurement, draft_owner_memo=draft_owner_memo,
                check_texas_fast_track=check_texas_fast_track, list_tenants=list_tenants,
                plan_tenant_moves=plan_tenant_moves, challenge_plan=challenge_plan)


SYSTEM_PROMPT = """You are Lightwell's planner. You lead a team that turns empty downtown Houston offices into homes.
Context: since 1 Sep 2025 Texas SB 840 / SB 2477 let an office building 5+ years old convert to homes without rezoning,
traffic studies or extra parking, if at least 65% of it becomes residential. Houston has empty offices but the empty
space is scattered across towers and held up by tenants on long leases. Your job is to find the towers that can convert
and, where tenants are in the way, plan the tenant moves that unlock them.
The user's request has already been parsed into a brief (get_brief). If the request asks for something the brief doesn't
reflect (a home count, ignoring parking, requiring real data, a cost cap, no lightwells), call update_brief first.
Then, keeping every step short:
1. list_towers.
2. market-analyst: market records and parking counts for all towers, and any occupancy discrepancies.
   data-scout: if towers have no CoStar record, estimate their missing occupancy from comparable CoStar towers
   (estimate_missing_data), and after ranking, list which towers to ask CoStar about next (rank_data_requests).
3. feasibility-engineer: rank the towers, then test conversion, the fire screen and check_daylight for the top 3.
   market-analyst: check_rents for the top 3 passing towers: does the real CoStar market rent cover the rent each needs?
4. policy-analyst: Texas fast-track status for the top 5 passing towers.
5. Review: call review_evidence on the top 3 passing towers. If a gap is decision-relevant for the leader, call
   request_measurement for it (one sentence why). After the answer, call rank_towers again and explain how the ranking
   changed. Never recommend a tower that fails the brief.
6. deal-maker: for your leading tower, if it needs tenant moves, plan them (goal 'fast'); compare with the next tower if
   the cost per home unlocked is high.
7. red-team: challenge the move plan. If the verdict is 'weak', either pick another tower (repeat 6-7 once) or say
   clearly what must be true for the plan to work.
8. draft_owner_memo for your single best passing tower, with a two-sentence rationale that names the move plan.
Finish with two sentences: the pick and why. Values tagged SIMULATED, ESTIMATE, ASSUMED or MISSING are not measured:
say so when you rely on them. Occupancy discrepancies are observations to investigate, never accusations.
The fire screen is preliminary; never call a tower fire-safe. The fast-track screen is not legal advice.
Daylight X-ray is a screening check against neighbouring buildings, not a daylight study; never call a tower
daylight-compliant."""


def run_llm(s: Session):
    from deepagents import create_deep_agent  # imported lazily: the scripted path needs no LLM packages

    t = make_tools(s)
    market = {"name": "market-analyst", "description": "Pulls CoStar market records and Vexcel parking counts; finds occupancy discrepancies.",
              "system_prompt": "Use your tools on the tower ids you are given. Return a short factual summary with source tags.",
              "tools": [t["get_market_records"], t["count_parking"], t["find_occupancy_mismatches"], t["check_rents"]]}
    feas = {"name": "feasibility-engineer", "description": "Reads floor plates, ranks towers, tests conversion, the preliminary fire screen and daylight from neighbours.",
            "system_prompt": "Use rank_towers first, then test_conversion, check_fire_safety and check_daylight on the towers you are asked about. Be brief.",
            "tools": [t["read_floor_plates"], t["rank_towers"], t["test_conversion"], t["check_fire_safety"], t["check_daylight"]]}
    policy = {"name": "policy-analyst", "description": "Screens towers against the Texas SB 840 / SB 2477 conversion fast-track (age, 65% residential).",
              "system_prompt": "Call check_texas_fast_track on the towers you are given. Report which are ready, which need how many "
                               "floors freed, and any missing year built. Say it is a screen, not legal advice.",
              "tools": [t["check_texas_fast_track"]]}
    deals = {"name": "deal-maker", "description": "Reads CoStar tenants and leases and plans the tenant moves that unlock a tower for homes.",
             "system_prompt": "Call list_tenants, then plan_tenant_moves (goal 'fast' unless told otherwise). Report moves, cost, homes "
                              "unlocked and cost per home unlocked. Say when tenant data is simulated.",
             "tools": [t["list_tenants"], t["plan_tenant_moves"], t["check_texas_fast_track"]]}
    scout = {"name": "data-scout", "description": "Works on towers with no CoStar record: estimates missing occupancy from comparable "
                                                   "CoStar towers and ranks which towers are worth requesting from CoStar next.",
             "system_prompt": "Call estimate_missing_data, then rank_data_requests. Report how many towers were estimated, the "
                              "confidence, and the top 3 towers to request from CoStar with the reason for each. Estimates are "
                              "not measurements: say so.",
             "tools": [t["estimate_missing_data"], t["rank_data_requests"], t["explain_tower"]]}
    red = {"name": "red-team", "description": "Attacks a tenant-move plan and the evidence behind the pick; returns the strongest objections.",
           "system_prompt": "You are a skeptical broker and lender. Call challenge_plan on the tower, and review_evidence if useful. "
                            "Return the verdict and the two strongest objections, each with what would resolve it. Be blunt and brief.",
           "tools": [t["challenge_plan"], t["review_evidence"], t["list_tenants"]]}
    agent = create_deep_agent(model=MODEL, tools=[t["list_towers"], t["get_brief"], t["update_brief"], t["rank_towers"],
                                                  t["review_evidence"], t["request_measurement"], t["draft_owner_memo"]],
                              system_prompt=SYSTEM_PROMPT, subagents=[market, scout, feas, policy, deals, red])
    s.emit("Planner", f"Planning with {MODEL.split(':')[-1]} (deepagents). Brief: {brief_text(s.S)}.")
    result = agent.invoke({"messages": [{"role": "user", "content": f"{s.prompt}\n\nParsed brief: {json.dumps(s.S)}"}]})
    msgs = result.get("messages", []) if isinstance(result, dict) else []
    final = getattr(msgs[-1], "content", "") if msgs else ""
    if isinstance(final, list):
        final = " ".join(p.get("text", "") for p in final if isinstance(p, dict))
    if final:
        s.emit("Planner", str(final)[:600])
    if not s.top:   # the model forgot to pick: fall back to the best ranked tower
        run_pick(s, t)


ASK_PROMPT = """You are Lightwell, answering a question about downtown Houston office towers that could become homes.
Context: Texas SB 840 / SB 2477 (Sep 2025) let 5+ year old offices convert by right if 65% becomes homes. The towers,
the screen (daylight, cost per home, fire screen, Texas fast-track, tenant moves) and the data sources are in your tools.
Answer with the tools, never from memory: explain_tower, compare_towers, rank_towers, preview_brief (what-if without
changing anything), update_brief (only if the user asks to change the brief), estimate_missing_data and
rank_data_requests (towers with no CoStar record), check_rents (rent needed vs real CoStar asking rents, affordability), check_texas_fast_track, plan_tenant_moves, challenge_plan, check_daylight.
Then call answer_user once: at most 6 short sentences, concrete numbers, tower ids like HOU-07, and say when a value is
ESTIMATE, SIMULATED, ASSUMED or MISSING rather than measured. Never call a tower fire-safe or daylight-compliant; the
fast-track screen is not legal advice. Use at most 8 tool calls."""


def rent_text(s: Session, ids):
    """Same sentence as LW.rentText in lightwell/js/agent.js."""
    R = [(t, rent_check(s.get(t), s.A)) for t in ids]
    R = [(t, r) for t, r in R if r]
    if not R:
        return None
    if all(r["verdict"] == "no_data" for _, r in R):
        return ("Rent needed per home: " + ", ".join(f"{t} ${r['required']:,}/month" for t, r in R)
                + ". No CoStar rents loaded to compare (run backend/rent_comps.py).")
    return "; ".join(f"{t}: needs ${r['required']:,}/month, nearby CoStar listings ask ${r['market']:,} ({r['n']} within {r['radius_m']:,} m): "
                     f"{RENT_LABEL[r['verdict']].lower()}" for t, r in R if r["verdict"] != "no_data") + "."


def run_ask(s: Session):
    """Ask Lightwell (needs an Anthropic key): one question, answered with the same tools as the run."""
    from deepagents import create_deep_agent

    t = make_tools(s)
    s.analyse_all()   # estimates the page already applied arrive tagged ESTIMATE, so they stay applied
    agent = create_deep_agent(model=MODEL, tools=[t[k] for k in (
        "list_towers", "get_brief", "update_brief", "rank_towers", "explain_tower", "compare_towers", "preview_brief",
        "estimate_missing_data", "rank_data_requests", "check_texas_fast_track", "list_tenants", "plan_tenant_moves",
        "challenge_plan", "check_daylight", "test_conversion", "check_fire_safety", "check_rents", "answer_user")], system_prompt=ASK_PROMPT)
    msgs = [{"role": m["role"], "content": str(m["text"])[:1500]} for m in s.history[-6:] if m.get("role") in ("user", "assistant") and m.get("text")]
    msgs.append({"role": "user", "content": s.question})
    result = agent.invoke({"messages": msgs})
    if not s.answer:   # the model answered in plain text instead of calling answer_user
        out = result.get("messages", []) if isinstance(result, dict) else []
        final = getattr(out[-1], "content", "") if out else ""
        if isinstance(final, list):
            final = " ".join(p.get("text", "") for p in final if isinstance(p, dict))
        s.answer = {"text": str(final) or "I couldn't find an answer with the data loaded.", "ids": []}
    s.events.put({"type": "answer", **s.answer, "brief": s.S, "estimates": s.estimates, "moves": s.moves, "challenge": s.challenge,
                  "by": MODEL.split(":")[-1]})


def brief_text(S):
    return (f"under {money(S['cap'])}/home, homes within {S['u']} ft of a window, {S['minHomes']}+ homes"
            f"{', lightwells allowed' if S['allowLW'] else ', no lightwells'}{'' if S['useParking'] else ', parking ignored'}"
            + (f", real {' + '.join(LAYER_NAME[k] for k in S['require'])} data required" if S["require"] else ""))


def run_pick(s: Session, t, rationale=""):
    s.analyse_all()
    best = [b for b in s.ranked() if b.passes]
    lead = getattr(s, "lead", None)
    pick = next((b for b in best if b.id == lead), best[0] if best else None)
    if pick:
        t["draft_owner_memo"](pick.id, rationale)


def run_scripted(s: Session):
    """Same tools, fixed order (no Anthropic key). Includes the review-and-replan step."""
    t = make_tools(s)
    s.emit("Planner", f"No Anthropic key set: running Lightwell's fixed plan with the same tools. Brief: {brief_text(s.S)}.")
    ids = list(s.buildings)
    t["list_towers"]()
    t["get_market_records"](ids)
    t["count_parking"](ids)
    if any(b.src.get("rep") == "MISSING" for b in s.buildings.values()):
        t["estimate_missing_data"]()
    t["read_floor_plates"](ids)
    top = [r for r in json.loads(t["rank_towers"](5)) if r["passes"]][:3]
    t["rank_data_requests"](5)
    for row in top:
        t["test_conversion"](row["id"])
        t["check_fire_safety"](row["id"])
    if top:
        t["check_daylight"]([r["id"] for r in top])
    t["find_occupancy_mismatches"]()
    if top:
        gaps = json.loads(t["review_evidence"]([r["id"] for r in top]))
        rel = [g for g in gaps if g["relevant"] and g["id"] == top[0]["id"]]
        if rel:
            g = rel[0]
            t["request_measurement"](g["id"], g["field"], f"At {g['what_if']}, {g['id']} {g['decision']}.")
    passing = [b.id for b in s.ranked() if b.passes][:3]
    if passing:
        t["check_rents"](passing)
    run_deal(s, t)
    run_pick(s, t)


def run_deal(s: Session, t):
    """Policy screen, tenant moves and red team for the leader; try the next passing tower once if the plan is weak."""
    s.analyse_all()
    passing = [b.id for b in s.ranked() if b.passes]
    if not passing:
        return
    t["check_texas_fast_track"](passing[:5])
    for tid in passing[:4]:
        ft = fast_track(s.get(tid))
        if ft["status"] == "unknown":
            continue
        if ft["status"] == "shuffle":
            t["list_tenants"](tid)
            t["plan_tenant_moves"](tid, "fast")
        else:
            s.moves = None
        c = json.loads(t["challenge_plan"](tid)) if s.moves else {"verdict": "holds"}
        if c["verdict"] != "weak":
            s.lead = tid
            return
        s.emit("Planner", f"Red team found the plan for {tid} weak; trying the next tower.")
    s.lead = passing[0]
