"""Count parked cars in an aerial image (e.g. a Vexcel tile of one building's lot) with Claude, and append the result
to real-data/parking.csv.

    python backend/count_cars.py lot.jpg --costar-id 1234567 --date 2026-11-14
    python backend/count_cars.py lot.jpg --costar-id 1234567 --date 2026-11-14 --dry-run   # print only

Needs ANTHROPIC_API_KEY (in the project's .env file, or an `ant auth login` profile). Hand-check a few lots before
trusting the counts.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import mimetypes
import sys
from pathlib import Path

import anthropic

import env  # noqa: F401  (loads ANTHROPIC_API_KEY from the project's .env)

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-opus-5-5"

SCHEMA = {
    "type": "object",
    "properties": {
        "spaces_total": {"type": "integer", "description": "Marked parking spaces visible in the lot(s)"},
        "cars_counted": {"type": "integer", "description": "Vehicles parked in those spaces"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": {"type": "string", "description": "Anything that limits the count: shadows, trees, cropping, a garage roof"},
    },
    "required": ["spaces_total", "cars_counted", "confidence", "notes"],
    "additionalProperties": False,
}

PROMPT = """This is an overhead aerial photo of a parking lot that serves one office building.
Count the marked parking spaces and the vehicles parked in them. Count only surface spaces you can see;
ignore cars driving on streets. If part of the lot is hidden (trees, shadow, edge of the image), estimate the
hidden spaces from the visible pattern and say so in notes. If there is no surface lot (only a garage roof or none),
return 0 spaces and explain."""


def count(image: Path) -> dict:
    media = mimetypes.guess_type(image.name)[0] or "image/jpeg"
    data = base64.standard_b64encode(image.read_bytes()).decode()
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",     # if the request is declined, the API retries it on a fallback model
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}},
            {"type": "text", "text": PROMPT},
        ]}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("The request was declined; count this lot by hand.")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", type=Path)
    ap.add_argument("--costar-id", required=True)
    ap.add_argument("--date", required=True, help="capture date of the image, YYYY-MM-DD")
    ap.add_argument("--csv", type=Path, default=ROOT / "real-data" / "parking.csv")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    try:
        r = count(a.image)
    except anthropic.APIConnectionError:
        sys.exit("Network error reaching the Claude API.")
    except anthropic.AuthenticationError:
        sys.exit("The Anthropic key was rejected: check ANTHROPIC_API_KEY in the project's .env file.")
    except TypeError as e:   # the SDK raises this when it finds no credentials at all
        if "auth" not in str(e).lower():
            raise
        sys.exit("No Anthropic credentials: put ANTHROPIC_API_KEY in the project's .env file (see .env.example) or run `ant auth login`.")
    except anthropic.APIStatusError as e:
        sys.exit(f"Claude API error {e.status_code}: {e.message}")

    pct = r["cars_counted"] / r["spaces_total"] if r["spaces_total"] else 0
    print(f"{a.image.name}: {r['cars_counted']} cars / {r['spaces_total']} spaces ({pct:.0%} full), "
          f"confidence {r['confidence']}. {r['notes']}")
    if a.dry_run or not r["spaces_total"]:
        return
    new = not a.csv.exists()
    a.csv.parent.mkdir(parents=True, exist_ok=True)
    with a.csv.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["costar_id", "capture_date", "spaces_total", "cars_counted", "source", "confidence", "notes", "image_ref"])
        w.writerow([a.costar_id, a.date, r["spaces_total"], r["cars_counted"], "vexcel+claude", r["confidence"], r["notes"], Path(a.image).name])
    print(f"Appended to {a.csv}")


if __name__ == "__main__":
    main()
