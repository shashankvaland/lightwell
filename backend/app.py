"""Lightwell backend: streams agent steps to the browser.

Run:  uvicorn app:app --port 8000      (from the backend/ folder)
Set ANTHROPIC_API_KEY in your environment to use Claude through deepagents; without it the fixed plan runs.
"""
from __future__ import annotations

import json
import os
import threading
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent import MODEL, Session, run_llm, run_scripted

app = FastAPI(title="Lightwell backend")
# Local development only: the page may be opened from disk (origin "null") or a local server.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])


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


@app.post("/api/run")
async def run(request: Request):
    payload = await request.json()
    s = Session(payload)
    use_llm = llm_available()

    def work():
        try:
            run_llm(s) if use_llm else run_scripted(s)
            s.events.put({"type": "done", "top": s.top, "memo": s.memo})
        except Exception as e:  # report the failure to the page instead of hanging the stream
            traceback.print_exc()
            s.events.put({"type": "error", "message": f"{type(e).__name__}: {e}"})
        finally:
            s.events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        while True:
            ev = s.events.get()
            if ev is None:
                break
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
