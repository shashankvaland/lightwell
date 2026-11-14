"""Loads keys from the project's .env file into the environment (KEY=value lines), without overriding anything set.

.env is git-ignored. Copy .env.example to .env and fill it in; never commit it or paste keys into chat.
Imported for its side effect by app.py, costar_kit.py, matterport.py and count_cars.py. Restart the backend after
editing .env.
"""
from __future__ import annotations

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load(path: Path = ENV_FILE) -> list[str]:
    """Set each KEY=value from the file that is not already in the environment; empty values are skipped.
    Returns the names it set (never the values)."""
    if not path.exists():
        return []
    done = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip().removeprefix("export ").strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
            val = val[1:-1]
        if key and val and key not in os.environ:
            os.environ[key] = val
            done.append(key)
    return done


load()
