# Lightwell

Find the empty offices that can become homes, and prove it from above, inside and on the books.
Built for HackPrinceton F26. Main track: Best Sustainability Hack.

## Run it

**Front end** (no install needed):
```
python -m http.server 8765
```
Open http://localhost:8765/lightwell/index.html. Double-clicking `lightwell/index.html` also works.

**Agent backend** (optional; the page has a built-in offline agent):
```
cd backend
pip install -r requirements.txt
uvicorn app:app --port 8000
```
- With `ANTHROPIC_API_KEY` set in your environment, the agent is Claude running through LangChain deepagents
  (planner + `market-analyst` + `feasibility-engineer` sub-agents). Change the model with `LIGHTWELL_MODEL`.
- Without a key, the backend runs the same tools in a fixed order, so the demo never depends on the network.

**Photoreal 3D (Google)**: copy `lightwell/config.example.js` to `lightwell/config.js` (git ignores that file, so keys stay out of the repo) and put **one** of these in yourself:
- `GOOGLE_MAPS_API_KEY`: a Google Maps Platform key with the **Map Tiles API** enabled, or
- `CESIUM_ION_TOKEN`: a Cesium ion token (serves the same Google tiles).

Then press **Photoreal 3D**. Without a key that button shows the OpenStreetMap buildings in 3D instead.
Never commit a key to a public repo; restrict it to your domain in the Google Cloud console.

## What it does
1. **Ask** in plain English: "offices downtown I can turn into homes for under $300k a home".
2. The agent loads the **real downtown Houston buildings** (1,220 OpenStreetMap footprints, 58 towers tested).
3. **Daylight test** on every floor plate: homes only where a bedroom is within ~30 ft of a window.
4. **Lightwell option**: cut a courtyard through deep floors to create a second window wall.
5. **Fire-safety screen**: farthest home to a stair, stair separation, sprinkler retrofit for pre-1975 towers.
6. **Hidden-vacancy flags**: reported occupancy vs. cars counted in aerial images.
7. **Rank**, then a human **approves** the owner memo. Export the ranking as CSV or a portfolio memo.

You can also **correct data** on any tower (leased %, year built, floor height) and it re-scores, and edit every
**assumption** (cost per sq ft, carbon factors, travel limit) in the left panel.

## Real vs simulated
| Real now | Simulated until the event |
|---|---|
| Footprints, heights, floor-plate sizes (OpenStreetMap) | Occupancy, leases, year built (CoStar) |
| Street map (OpenFreeMap) | Parking counts (Vexcel) |
| Google photoreal city (with your key) | Interior scans (Matterport) |

Real building names are hidden (towers show as HOU-01, HOU-02...) while market data is simulated, so no invented
figure is ever attached to a real, named building.

**Adding real data:** save CoStar, Vexcel and Matterport results as the CSVs described in
[real-data/README.md](real-data/README.md), then run `python backend/import_data.py`. It matches each row to a real
footprint and writes `lightwell/data/real_overlay.js`. Towers with real CoStar data then show their address and real
source tags; everything else stays tagged SIMULATED. `backend/count_cars.py` counts cars in an aerial image with Claude.
The step-by-step plan for the first hours of the event is in [EVENT_DAY.md](EVENT_DAY.md).

## Files
```
lightwell/index.html        the app
lightwell/config.js         your keys and backend URL (copy from config.example.js; not committed)
lightwell/js/engine.js      daylight test, lightwell, fire screen, cost, carbon, score
lightwell/js/data.js        OSM footprints -> candidate towers (+ simulated market data)
lightwell/js/views.js       MapLibre map view and CesiumJS / Google 3D view
lightwell/js/ui.js          panels, floor plate, corrections, assumptions, memo, CSV
lightwell/js/agent.js       talks to the backend, or runs the plan in the browser
lightwell/data/             downtown Houston buildings (GeoJSON + a .js copy for file://)
backend/engine.py           Python copy of engine.js (keep in sync)
backend/agent.py            deepagents planner, sub-agents and tools
backend/app.py              FastAPI server streaming agent steps
backend/import_data.py      joins real-data/*.csv to the map and writes the overlay
backend/count_cars.py       Claude vision: cars and spaces in an aerial lot image
real-data/                  where the real CSVs go (templates + column guide)
EVENT_DAY.md                first-hours checklist for the hackathon
```

Map data © OpenStreetMap contributors. All costs and carbon figures are planning estimates.
