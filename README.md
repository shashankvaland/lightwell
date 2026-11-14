# Lightwell

**Find the empty offices that can become homes, and prove it from above, inside and on the books.**

About one in four office desks in downtown Houston sits empty, while the city needs homes. Most offices can't be
converted because their floors are too deep: a bedroom needs a window, and the middle of an office floor is
60-120 ft from the glass. Lightwell finds the towers that *can* convert, tests every floor, tries cutting a
courtyard (a *lightwell*) to bring light to the core, checks fire safety, and drafts the owner memo.

Built for **HackPrinceton F26** · Main track: **Best Sustainability Hack**

---

## What it does

1. **Ask in plain English:** *"Find offices downtown I can turn into homes for under $300k a home."*
2. **An AI agent plans the run** and hands work to sub-agents for market data, aerial data, interiors, feasibility,
   fire safety and forensics, streaming each step live.
3. **Real downtown Houston:** 1,220 building footprints and heights from OpenStreetMap, of which 58 towers qualify,
   on a 3D map or Google's photoreal 3D city.
4. **Daylight test on every floor:** homes only where a bedroom is within about 30 ft of a window.
5. **Cut a lightwell:** one click carves a courtyard through a deep floor and re-runs homes, cost and score.
6. **Fire-safety screen:** distance from the farthest home to a stair, stair separation, sprinkler retrofit.
7. **Hidden-vacancy signals:** reported occupancy compared with cars counted in aerial images, flagged *to verify*.
8. **Human in the loop:** correct any value, then approve the owner memo, or export a portfolio memo and a CSV.

| Feature | Where |
|---|---|
| Ranked 3D map coloured by conversion score | Map / Photoreal 3D toggle |
| Floor-plate test-fit with homes, core, lightwell and escape route | Floor plate panel |
| Live constraints (window distance, cost cap, lightwell on/off) | Left panel |
| Editable assumptions (cost, carbon, travel limit) | Left panel → Assumptions |
| Source tag on every number: COSTAR, VEXCEL, MATTERPORT, OSM, SIMULATED, YOU | Building card |

## Quick start

Needs Python 3.10+. Works on Windows, macOS and Linux.

```bash
git clone https://github.com/shashankvaland/lightwell.git
cd lightwell
pip install -r backend/requirements.txt
```

**1. Website**
```bash
python -m http.server 8765
```
Open http://localhost:8765/lightwell/index.html. Without the backend, it runs a built-in offline agent.

**2. Agent backend (optional, second terminal)**
```bash
cd backend
python -m uvicorn app:app --port 8000
```
- With `ANTHROPIC_API_KEY` set, the agent is **Claude running through LangChain deepagents**.
  Change the model with `LIGHTWELL_MODEL`.
- Without a key, the backend runs the same tools in a fixed order, so the demo never depends on the network.

**3. Photoreal 3D (optional)**
Copy `lightwell/config.example.js` to `lightwell/config.js`, then add **one** of these:
- `CESIUM_ION_TOKEN`: free Cesium ion account, no card needed. Serves Google Photorealistic 3D Tiles.
- `GOOGLE_MAPS_API_KEY`: Google Maps Platform key with the **Map Tiles API** enabled.

`config.js` is git-ignored, so keys never reach the repo. Without a key, the Photoreal button shows the OSM
buildings in 3D.

## Adding real data (CoStar, Vexcel, Matterport)

Save API results as the three CSVs described in [real-data/README.md](real-data/README.md), then run:
```bash
python backend/import_data.py
```
Each row is matched to a real footprint (point-in-polygon, then nearest within 40 m) and written to
`lightwell/data/real_overlay.js`. Towers with real CoStar data show their address and real source tags; everything
else stays tagged SIMULATED. `backend/count_cars.py` counts cars in an aerial lot image with Claude.
The first-hours plan for the hackathon is in [EVENT_DAY.md](EVENT_DAY.md). Real data files are git-ignored.

## Real vs simulated

| Real now | Simulated until the event |
|---|---|
| Footprints, heights, floor-plate sizes (OpenStreetMap) | Occupancy, leases, year built (CoStar) |
| Street map (OpenFreeMap) | Parking counts (Vexcel) |
| Google photoreal city (with your key) | Interior scans (Matterport) |

Real building names are hidden (towers show as HOU-01, HOU-02...) until real market data is loaded, so an invented
number is never attached to a real, named building. A hidden-vacancy dot is a signal to verify, never an accusation.

## How it works

```
 You ask ──► Planner (deepagents) ──► market-analyst ──► CoStar records, Vexcel counts, occupancy signals
                     │            └─► feasibility-engineer ──► floor plates, daylight test, lightwell, cost, fire screen
                     └─► review ──► top pick ──► you approve the memo
```

- `lightwell/js/engine.js` and `backend/engine.py` are the same feasibility engine in JS and Python. They are tested
  to give identical numbers.
- Score = daylight share 30% + vacancy 26% + cost per home 20% + ceiling height 6% + building age 8% + fire screen 10%.
- Cost and carbon are planning estimates and are editable in the app: $255/sq ft conversion, $420/sq ft lightwell
  cut, $400k per new-build home, 500 kg CO2e/m2 new-build carbon, 60% avoided by reuse.

## Project layout

```
lightwell/              the app (open lightwell/index.html)
  js/engine.js          daylight test, lightwell, fire screen, cost, carbon, score
  js/data.js            OSM footprints -> candidate towers; applies real data
  js/views.js           MapLibre map view and CesiumJS / Google 3D view
  js/ui.js              panels, floor plate, corrections, assumptions, memos, CSV
  js/agent.js           streams the backend agent, or runs the plan in the browser
  config.example.js     copy to config.js for your keys
  data/                 downtown Houston buildings (GeoJSON + .js copy for file://)
backend/
  agent.py              deepagents planner, sub-agents and tools
  engine.py             Python copy of engine.js
  app.py                FastAPI server streaming agent steps (SSE)
  import_data.py        joins real-data/*.csv to the map
  count_cars.py         Claude vision car counter for aerial images
real-data/              CSV templates and column guide
EVENT_DAY.md            hackathon first-hours checklist
*.pdf                   project plan (Lightwell) and the earlier FireTrace plan
lightwell.html, lightwell-houston.html, houston-map.html, firetrace-3d.html
                        earlier single-file prototypes, kept as offline backups
```

## Tracks

Best Sustainability Hack (main) · CoStar *AI for the Built World* · LangChain *Best use of deepagents* ·
Amazon *Best Practical AI Innovation* · Peri *Forward Deployed* · Arlequin *AI-Driven Forensics*

## Limits

Lightwell is a screening tool: it says where to look first. Daylight distances, fire rules and costs vary by city
and building; an architect, fire engineer and cost consultant make the final call.

## Credits

Map data © OpenStreetMap contributors (ODbL). Street tiles by OpenFreeMap. 3D by MapLibre GL and CesiumJS.
Photorealistic 3D Tiles © Google. Agent built with LangChain deepagents and Claude.
