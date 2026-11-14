"""Backend run with the scripted agent: streams steps, asks for a measurement, re-ranks with the answer, returns
the reviewed result and the correction so the browser can show exactly what the agent reviewed."""
import json
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
JS = ROOT / "tests" / "js_results.json"
pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")
uvicorn = pytest.importorskip("uvicorn")
PORT = 8799


@pytest.fixture(scope="module")
def client():
    import socket
    import time
    import app as appmod
    server = uvicorn.Server(uvicorn.Config(appmod.app, port=PORT, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", PORT), timeout=0.1).close(); break
        except OSError:
            time.sleep(0.05)
    with httpx.Client(base_url=f"http://127.0.0.1:{PORT}", timeout=30) as c:
        yield c
    server.should_exit = True


def payload(S=None):
    rows = json.loads(JS.read_text())[0]["rows"]
    bs = []
    for r in rows:
        b = dict(r["input"])
        b["src"] = {"f2f": "ESTIMATE", "core": "ASSUMED", "rep": "SIMULATED", "year": "SIMULATED", "obs": "SIMULATED", "plate": "OSM"}
        bs.append(b)
    return {"prompt": "test", "constraints": S or {}, "assumptions": {}, "buildings": bs, "key": "k1", "scripted": True}


def run(client, body, answer=None):
    events = []
    with client.stream("POST", "/api/run", json=body) as r:
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:])
            events.append(ev)
            if ev["type"] == "ask":
                httpx.post(f"http://127.0.0.1:{PORT}/api/answer", json={"session": ev["session"], "ask_id": ev["ask_id"], "value": answer})
    return events


@pytest.mark.skipif(not JS.exists(), reason="run `node tests/parity.mjs` first")
def test_replan_changes_the_pick(client):
    c = client
    ev = run(c, payload(), answer="10")
    ask = next(e for e in ev if e["type"] == "ask")
    done = ev[-1]
    assert done["type"] == "done" and done["key"] == "k1"
    assert ask["tower"] in done["corrections"] and done["corrections"][ask["tower"]]["f2f"] == 10.0
    assert done["top"] != ask["tower"]                       # the measurement changed the recommendation
    assert done["reviewed"]["id"] == done["top"] and done["reviewed"]["passes"]
    assert any("Re-ranked" in e.get("text", "") for e in ev)


@pytest.mark.skipif(not JS.exists(), reason="run `node tests/parity.mjs` first")
def test_skip_keeps_estimate(client):
    c = client
    ev = run(c, payload(), answer=None)
    done = ev[-1]
    assert done["corrections"] == {} and done["top"]


@pytest.mark.skipif(not JS.exists(), reason="run `node tests/parity.mjs` first")
def test_brief_min_homes_flows_through(client):
    c = client
    ev = run(c, payload({"minHomes": 200, "useParking": False}), answer=None)
    done = ev[-1]
    assert done["reviewed"]["homes"] >= 200
    assert all(not r["hidden_vacancy_flag"] for r in done["results"].values())
