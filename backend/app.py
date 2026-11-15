"""Lightwell backend: streams agent steps to the browser.

Run:  uvicorn app:app --port 8000      (from the backend/ folder)
Set ANTHROPIC_API_KEY (in the project's .env file, or your environment) to use Claude through deepagents; without it
the fixed plan runs.
"""
from __future__ import annotations

import json
import os
import threading
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import env  # noqa: F401  (loads the project's .env before the agent reads its settings)
from agent import MODEL, Session, run_ask, run_llm, run_scripted

app = FastAPI(title="Lightwell backend")
# Local development only: the page may be opened from disk (origin "null") or a local server.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
SESSIONS: dict[str, Session] = {}


def llm_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import deepagents  # noqa: F401
        return True
    except ImportError:
        return False


@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm_available(), "model": MODEL.split(":")[-1]}


@app.post("/api/answer")
async def answer(request: Request):
    """The user's reply to a request_measurement question: {session, ask_id, value} (value null or "" to skip)."""
    body = await request.json()
    s = SESSIONS.get(body.get("session"))
    q = s.answers.get(body.get("ask_id")) if s else None
    if q is None:
        raise HTTPException(404, "No open question with that id (the run may have finished).")
    q.put(body.get("value"))
    return {"ok": True}


@app.post("/api/ask")
async def ask(request: Request):
    """Ask Lightwell: one question about the towers, answered by Claude with the agent's tools (needs an Anthropic key;
    without one the page answers in the browser). Streams tool steps, then {"type": "answer", text, ids, ...}."""
    if not llm_available():
        raise HTTPException(503, "No Anthropic key: the page answers questions in the browser.")
    return stream_session(Session(await request.json()), run_ask, final=False)


@app.post("/api/run")
async def run(request: Request):
    payload = await request.json()
    use_llm = llm_available() and not payload.get("scripted")
    return stream_session(Session(payload), run_llm if use_llm else run_scripted)


def stream_session(s: Session, fn, final=True):
    SESSIONS[s.id] = s

    def work():
        try:
            s.events.put({"type": "session", "session": s.id})
            fn(s)
            if final:
                s.events.put(s.result())
        except Exception as e:  # report the failure to the page instead of hanging the stream
            traceback.print_exc()
            s.events.put({"type": "error", "message": f"{type(e).__name__}: {e}"})
        finally:
            s.events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        try:
            while True:
                ev = s.events.get()
                if ev is None:
                    break
                yield f"data: {json.dumps(ev)}\n\n"
        finally:
            SESSIONS.pop(s.id, None)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
