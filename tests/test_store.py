"""Run history (backend/store.py) against an in-memory MongoDB (mongomock), plus the page served by the backend."""
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
mongomock = pytest.importorskip("mongomock")
pytest.importorskip("pymongo")
pytest.importorskip("fastapi")


@pytest.fixture()
def client(monkeypatch):
    import pymongo
    monkeypatch.setattr(pymongo, "MongoClient", mongomock.MongoClient)
    monkeypatch.setenv("MONGODB_URI", "mongodb://test")
    import agent
    monkeypatch.setattr(agent, "ASK_TIMEOUT_S", 1)   # the scripted run asks for measurements; don't wait 5 minutes
    import store
    monkeypatch.setattr(store, "_db", None)
    monkeypatch.setattr(store, "_failed_at", 0.0)
    from fastapi.testclient import TestClient
    import app
    return TestClient(app.app)


def towers():
    p = ROOT / "tests" / "js_results.json"
    if not p.exists():
        pytest.skip("run node tests/parity.mjs first")
    rows = json.loads(p.read_text())[0]["rows"]
    return [{**r["input"], "src": {"rep": "SIMULATED"}} for r in rows]


def test_runs_are_saved_and_ranked(client):
    assert client.get("/api/health").json()["store"] is True
    tops = []
    for cap in (300000, 350000):
        r = client.post("/api/run", json={"buildings": towers(), "constraints": {"cap": cap}, "scripted": True})
        done = json.loads([x for x in r.text.split("\n\n") if x.startswith("data:")][-1][5:])
        tops.append(done["top"])
    runs = client.get("/api/runs").json()["runs"]
    assert len(runs) == 2 and runs[0]["brief"]["cap"] == 350000 and runs[0]["at"].endswith("+00:00")
    assert runs[0]["ranked"][0]["id"] == tops[1] and runs[0]["towers"] == len(towers())
    board = client.get("/api/leaderboard").json()["towers"]
    assert sum(t["wins"] for t in board) == 2
    assert client.get(f"/api/towers/{tops[0]}/history").json()["wins"] >= 1


def test_backend_serves_the_page(client):
    assert client.get("/", follow_redirects=False).headers["location"] == "/lightwell/index.html"
    page = client.get("/lightwell/index.html")
    assert page.status_code == 200 and "js/history.js" in page.text


def test_no_store_without_uri(monkeypatch):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    import store
    monkeypatch.setattr(store, "_db", None)
    assert store.recent_runs() == [] and store.leaderboard() == [] and not store.enabled()
