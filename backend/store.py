"""Run history in MongoDB Atlas (optional).

Set MONGODB_URI in the project's .env (an Atlas connection string, mongodb+srv://...) and install pymongo. Every finished
agent run and every Ask Lightwell answer is then saved, so the team and the judges share one history: what brief was
asked, which tower won, why, and what the red team said. Without MONGODB_URI (or pymongo) nothing is saved and the app
works as before.

Collections (database LIGHTWELL_DB, default "lightwell"):
  runs  {at, mode, prompt, brief, top, top_summary, memo, review, passing, ranked, estimates, data}
  asks  {at, question, text, ids, by}
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

_db = None
_err: str | None = None
_failed_at = 0.0   # after a failed connection, wait a minute before trying again (so runs never stall on Atlas)


def db():
    """The Atlas database, or None when it is not configured or not reachable (the reason is in last_error())."""
    global _db, _err, _failed_at
    if _db is not None:
        return _db
    uri = os.environ.get("MONGODB_URI")
    if not uri or time.time() - _failed_at < 60:
        return None
    try:
        from pymongo import MongoClient
        client = MongoClient(uri, serverSelectionTimeoutMS=4000, appname="lightwell", tz_aware=True)
        client.admin.command("ping")
        _db = client[os.environ.get("LIGHTWELL_DB", "lightwell")]
        _db.runs.create_index([("at", -1)])
        _db.runs.create_index([("top", 1), ("at", -1)])
        _db.asks.create_index([("at", -1)])
        _err = None
    except Exception as e:  # missing pymongo, bad URI, network: run without history
        _err = f"{type(e).__name__}: {e}"[:200]
        _db, _failed_at = None, time.time()
    return _db


def last_error() -> str | None:
    return _err


def enabled() -> bool:
    return db() is not None


def _now():
    return datetime.now(timezone.utc)


def _iso(t):
    if isinstance(t, datetime):
        return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).isoformat()
    return t


def _clean(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    doc["at"] = _iso(doc.get("at"))
    return doc


def save_run(s, result: dict, mode: str) -> str | None:
    """Save one finished agent run. Keeps the ranking (top 10) and the decision, not every tower's full record."""
    d = db()
    if d is None or not result:
        return None
    rows = result.get("results") or {}
    ranked = sorted(((k, v) for k, v in rows.items() if v), key=lambda kv: -(kv[1].get("score") or 0))
    passing = [k for k, v in ranked if v.get("passes")]
    src = {}
    for b in s.buildings.values():
        tag = (b.src or {}).get("rep") or "?"
        src[tag] = src.get(tag, 0) + 1
    doc = {
        "at": _now(), "mode": mode, "prompt": s.prompt, "brief": result.get("brief"),
        "top": result.get("top"), "top_summary": result.get("reviewed"), "memo": result.get("memo"),
        "review": result.get("review") or [], "challenge": result.get("challenge"),
        "passing": len(passing), "towers": len(rows),
        "ranked": [{"id": k, "score": v.get("score"), "passes": bool(v.get("passes")), "homes": v.get("homes"),
                    "cost_per_home": v.get("cost_per_home")} for k, v in ranked[:10]],
        "estimates": len(result.get("estimates") or []),
        "data": src,  # how many towers had each data source for leasing (COSTAR, ESTIMATE, SIMULATED, MISSING)
    }
    try:
        return str(d.runs.insert_one(doc).inserted_id)
    except Exception as e:
        global _err
        _err = f"{type(e).__name__}: {e}"[:200]
        return None


def save_ask(question: str, answer: dict | None) -> None:
    d = db()
    if d is None or not answer:
        return
    try:
        d.asks.insert_one({"at": _now(), "question": question, "text": answer.get("text"), "ids": answer.get("ids") or [],
                           "by": answer.get("by")})
    except Exception:
        pass


def recent_runs(n: int = 10) -> list[dict]:
    d = db()
    if d is None:
        return []
    proj = {"memo": 0, "challenge": 0, "top_summary": 0}
    return [_clean(x) for x in d.runs.find({}, proj).sort("at", -1).limit(max(1, min(50, n)))]


def tower_history(tower: str) -> dict:
    """How often a tower came out on top, and the last few runs it won: the team's shared memory of a building."""
    d = db()
    if d is None:
        return {"tower": tower, "wins": 0, "runs": []}
    wins = d.runs.count_documents({"top": tower})
    runs = [_clean(x) for x in d.runs.find({"top": tower}, {"brief": 1, "at": 1, "top": 1, "passing": 1, "mode": 1})
            .sort("at", -1).limit(5)]
    return {"tower": tower, "wins": wins, "runs": runs}


def leaderboard(n: int = 10) -> list[dict]:
    """Towers ranked by how many saved runs picked them, across every brief anyone tried (an Atlas aggregation)."""
    d = db()
    if d is None:
        return []
    pipe = [{"$match": {"top": {"$ne": None}}},
            {"$group": {"_id": "$top", "wins": {"$sum": 1}, "last": {"$max": "$at"},
                        "caps": {"$addToSet": "$brief.cap"}}},
            {"$sort": {"wins": -1, "last": -1}}, {"$limit": max(1, min(50, n))}]
    return [{"tower": x["_id"], "wins": x["wins"], "last": _iso(x["last"]),
             "briefs": len(x["caps"])} for x in d.runs.aggregate(pipe)]
