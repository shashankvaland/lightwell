"""Rent check: would anyone pay the rent a converted tower needs? Mirrors LW.rentCheck in lightwell/js/rent.js.

b.rentMarket (sent by the browser) summarises real CoStar asking rents near the tower: n, radius, psf (median $/sq ft),
all (median rent), byBed {"0"|"1"|"2": {rent, n}}. Without it the check reports 'no_data'.
"""
from __future__ import annotations

import math

from engine import DEFAULT_ASSUMPTIONS, Building, jround

RENT_TYPES = ["Studio", "1-bed", "2-bed"]
RENT_LABEL = {"works": "Rents cover it", "close": "Rents nearly cover it", "gap": "Rents fall short", "no_data": "No CoStar rents loaded"}


def rent_check(b: Building, A=None):
    A = {**DEFAULT_ASSUMPTIONS, **(A or {})}
    p, m = b.plan, b.rentMarket
    if not p or not p["homes"] or not math.isfinite(p["cpu"]):
        return None
    required = jround((p["cpu"] * A["yieldOnCost"] + A["opexPerHomeYr"]) / (12 * (1 - A["rentVacancy"])))
    if not m:
        return {"verdict": "no_data", "required": required}
    total = p["mix"][0] + p["mix"][1] + p["mix"][2]
    types = []
    for t in (0, 1, 2):
        us = [u for u in p["L"]["units"] if u["t"] == t]
        if not us or not p["mix"][t]:
            continue
        area = sum(u["a"] for u in us) / len(us)
        bb = (m.get("byBed") or {}).get(str(t))
        rent = bb["rent"] if bb else jround(m["psf"] * area) if m.get("psf") else m["all"]
        basis = (f"median of {bb['n']} {RENT_TYPES[t]} listings" if bb else
                 f"median ${m['psf']:g}/sq ft x {jround(area)} sq ft" if m.get("psf") else "median of all listings")
        types.append({"t": t, "homes": p["mix"][t], "area": jround(area), "rent": rent, "basis": basis})
    market = jround(sum(x["rent"] * x["homes"] for x in types) / total)
    ratio = market / required
    supports = jround((market * 12 * (1 - A["rentVacancy"]) - A["opexPerHomeYr"]) / A["yieldOnCost"])
    income = jround(market * 12 / A["rentBurden"])
    return {"verdict": "works" if ratio >= 1 else "close" if ratio >= 0.9 else "gap", "required": required, "market": market,
            "gap": market - required, "ratio": jround(ratio * 100) / 100, "supports_cost_per_home": supports, "types": types,
            "income_needed": income, "income_share": jround(income / A["medianIncome"] * 100) / 100, "n": m["n"], "radius_m": m["radius"]}
