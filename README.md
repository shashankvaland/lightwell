# Lightwell

**Find the empty offices that can become homes, and prove it from above, inside and on the books.**

About one in four office desks in downtown Houston sits empty, while the city needs homes. Most offices can't be
converted because their floors are too deep: a bedroom needs a window, and the middle of an office floor is
60-120 ft from the glass. Lightwell finds the towers that *can* convert, tests every floor, tries cutting a
courtyard (a *lightwell*) to bring light to the core, runs a preliminary fire screen, asks you for the one measurement
that would change its recommendation, and drafts the owner memo.

Built for **HackPrinceton F26** · Main track: **Best Sustainability Hack**

**Why now:** since 1 September 2025, Texas SB 840 and SB 2477 let an office building at least 5 years old become homes
without rezoning, traffic studies or extra parking, if at least 65% of it becomes residential. Houston qualifies. But a
tower that is 40% empty can't reach 65% while tenants sit on scattered floors. Lightwell's agent team checks the 65% rule
on every tower and plans the **tenant moves** into nearby half-empty offices that would unlock it, and a **red-team agent**
attacks the plan before you see it. The app opens with a short, sourced screen on the law and the problem (*Why now?* reopens it).

---

## What it does

1. **Ask in plain English:** *"Find offices downtown I can turn into homes for under $300k a home"* or *"Only consider
   buildings with at least 200 homes and ignore parking activity."* The request becomes a **brief** (cost cap, minimum
   homes, window rule, lightwells, parking evidence, required real data) shown on screen and used by the engine. The
   agent can revise it with its `update_brief` tool.
2. **An AI agent plans the run** and hands work to sub-agents for market and aerial data and for feasibility and the
   fire screen, streaming each step live.
3. **Real downtown Houston:** 1,220 building footprints and heights from OpenStreetMap, of which 58 towers qualify,
   on a 3D map or Google's photoreal 3D city.
4. **Daylight test on every floor:** homes only where a bedroom is within about 30 ft of a window.
5. **Cut a lightwell:** one click carves a courtyard through a deep floor and re-runs homes, cost and score.
6. **Daylight X-ray:** checks every window wall, floor by floor, against the real neighbouring buildings, and lightwell
   courts against the tower's own height. Homes whose windows face a nearby building lower the daylight score (or, with
   *Strict daylight*, don't count at all). The **Daylight** view colours every floor by how much sky its windows see, red
   lines point to the blocking buildings, and Photoreal 3D plays real sun shadows for any hour on Dec 21 or Jun 21.
   A screening check, not a daylight study.
7. **Preliminary fire screen:** estimated travel from the farthest home to a stair, stair separation, sprinkler retrofit.
   It says what is measured, what is assumed (stair locations) and what is not verified. It never calls a tower fire-safe.
8. **Occupancy discrepancies:** reported occupancy compared with cars counted in aerial images, as observations to
   investigate.
9. **Review and replan:** the agent tests a worse plausible value for every estimated, assumed or simulated input on the
   shortlist. If one would change the decision, it pauses and asks you for that measurement, then re-ranks and explains
   what changed (*"HOU-53 now fails: floor-to-floor under 10.5 ft. New leader: HOU-34"*).
10. **Texas fast-track screen (SB 840 / SB 2477):** floors needed for 65% homes, floors empty now, building age. A screen,
   not legal advice.
11. **Tenant moves:** reads tenants and leases (CoStar records when imported, simulated otherwise), picks the tenants whose
    leases end soonest, moves each into the nearest tower with room (preferring towers that are poor conversion candidates,
    so they stay offices and fill up), and prices the incentives. Gold arcs on the map show every move.
12. **Red team:** attacks the move plan (long leases, far moves, receivers that are themselves good conversions, unverified
    age, simulated data). If the plan is weak, the planner tries the next tower.
13. **Human in the loop:** correct any value, then approve the memo the agent reviewed. The memo is marked *not
   reviewed* as soon as the brief, an assumption, a correction or the lightwell choice changes. Export a portfolio memo
   and a CSV with a source column per field.

| Feature | Where |
|---|---|
| Ranked 3D map coloured by conversion score | Map / Photoreal 3D toggle |
| Floor-plate test-fit with homes, core, lightwell and escape route | Floor plate panel |
| **Home designer:** click any home on the floor plate (or a floor in the card's stack or the 3D floor views) for 3-5 concept apartment plans: rooms, furniture, sizes, rule checks, wet-wall and cost notes; filter by bedrooms, baths, work nook, accessible bath, or describe it in words; save a plan for a run of floors | Building card → *Design homes* · Floor plate |
| Daylight X-ray: floors coloured by how much sky their windows see, lines to the blocking buildings, sun shadows | Daylight toggle · Photoreal 3D sun bar |
| Live constraints (window distance, cost cap, lightwell on/off) | Left panel |
| Editable assumptions (cost, carbon, travel limit) | Left panel → Assumptions |
| Source tag on every **field**: COSTAR, VEXCEL, MATTERPORT, OSM, ESTIMATE, ASSUMED, SIMULATED, MISSING, YOU | Building card |
| Evidence drawer: click any tag for the record, capture dates, car counts and confidence, scan id, assumptions | Building card |
| "Before a site visit" checklist from the evidence gaps, plus what the consulted business asked for | Building card, memo |
| Demo fill-in vs Real data only | Left panel |

## Quick start

Needs Python 3.10+. Works on Windows, macOS and Linux.

```bash
git clone https://github.com/shashankvaland/lightwell.git
cd lightwell
pip install -r backend/requirements.txt
```

**1. Agent backend (first terminal)**
```bash
cd backend
python -m uvicorn app:app --port 8000
```

**2. Website (second terminal, from the project folder)**
```bash
python -m http.server 8765
```
Open http://localhost:8765/lightwell/index.html. The page looks for the backend at `http://localhost:8000` (no config
needed). The badge under *Run agent* says which agent is running; if the backend isn't up, or fails mid-run, the page
switches to the built-in offline agent and the badge says so.

- With `ANTHROPIC_API_KEY` set (in `.env`, see the keys table below), the agent is **Claude running through LangChain deepagents**: a planner with five
  sub-agents (market-analyst, feasibility-engineer, policy-analyst, deal-maker, red-team). The strip under *Run agent*
  lights up whichever one is working.
  Change the model with `LIGHTWELL_MODEL`.
- Without a key, the backend runs the same tools in a fixed order, so the demo never depends on the network.

**3. Tests**
```bash
node tests/parity.mjs          # browser engine on all 58 towers -> tests/js_results.json
python -m pytest tests -q      # geometry, brief, missing data, JS/Python parity, backend review-and-replan
node tests/homes.mjs           # home designer: every plan on every home of every tower passes the room rules
```

**Home designer** (`lightwell/js/homes.js` + `lightwell/js/designer.js`). Each home on the floor plate is a rectangle
with glass on one side and the corridor on the other. The designer fits plan templates (studio, 1-3 beds, open or
entry kitchen, 1-2 baths, den) to it, rejects any plan that breaks a rule (bedroom without a window, room under minimum
size, bath under 5 × 7.5 ft, a room you can't reach, no bath off the hall), scores the rest (living space, light,
room sizes, right size for the type, shared wet wall, plumbing on the corridor side) and shows 3-5 different ones.
It reads the plate, core, daylight and empty-floor data and writes nothing back: the score, the agent's review, the
memo and the CSV are unchanged. Saved designs last for the browser session. These are concept plans, not drawings.

**4. Photoreal 3D (optional)**
Copy `lightwell/config.example.js` to `lightwell/config.js` (also where you change `BACKEND_URL`), then add **one** of these:
- `CESIUM_ION_TOKEN`: free Cesium ion account, no card needed. Serves Google Photorealistic 3D Tiles.
- `GOOGLE_MAPS_API_KEY`: Google Maps Platform key with the **Map Tiles API** enabled.

**In-app Street View** (the Street View button on each tower) uses **Mapillary** first: add a free Client Token from
mapillary.com/dashboard/developers as `MAPILLARY_TOKEN`. If Mapillary has no photo there, it uses Google Street View
when `GOOGLE_MAPS_API_KEY` has the **Maps JavaScript API** enabled. It zooms down to the tower and opens Google's street photos inside the page,
facing the building. Without the key it offers the 3D street-level view instead.

`config.js` is git-ignored, so keys never reach the repo. Without a key, the Photoreal button shows the OSM
buildings in 3D.

**5. Daylight X-ray data (already built)**
`lightwell/data/daylight.js` and `daylight.json` are committed (derived from the public OSM data). Rebuild them after
changing the building GeoJSON, or to use measured heights:
```bash
python backend/daylight.py                                   # OpenStreetMap heights
python backend/daylight.py --heights real-data/heights.csv   # columns osm_id,height_m (e.g. Vexcel); tagged VEXCEL
```

## Adding real data (CoStar, Vexcel, Matterport)

**CoStar data kit (HackPrinceton).** Put CoStar's `costar-hackathon-kit` folder next to the project folder (or set
`COSTAR_KIT_DIR` in `.env`), then:
```bash
python backend/costar_kit.py     # downtown office towers + current tenants -> real-data/costar.csv, tenants.csv
python backend/import_data.py    # -> lightwell/data/real_overlay.js; reload the page
```
The towers then carry their CoStar name, class and rating, percent leased (CoStar's formula, from the listings), empty
floors, slab-to-slab height, sprinklers, year built and renovated, and their real tenants for the tenant-move planner. A
building CoStar records as converted never passes. [real-data/README.md](real-data/README.md) says how each value is
made, how to add Matterport floor plates (`backend/matterport.py`) and Vexcel counts, and lists the CSV columns for
adding data by hand:
```bash
python backend/import_data.py
```
Each row is matched to a real footprint (point-in-polygon, then nearest within 40 m) and written to
`lightwell/data/real_overlay.js`. With an overlay loaded the app starts in **Real data only** mode: every value is
tagged by its own source, and anything missing stays MISSING (the engine states any assumption it makes, such as Houston
average vacancy). **Demo fill-in** simulates values only on anonymous towers, never next to a real name.

The agent's CoStar, Vexcel and Matterport tools read these imported values; they don't call the sponsor APIs live. `backend/count_cars.py` counts cars in an aerial lot image with Claude.

### Keys: where each one goes
| Key | Put it in | Used for |
|---|---|---|
| Matterport **SDK key** | `lightwell/config.js` → `MATTERPORT_SDK_KEY` | not needed today: the 3D tour of CoStar's scans opens without it (kept for a future feature that drives the tour with the SDK) |
| Matterport **API key** | `.env` → `MATTERPORT_API_KEY` | `backend/matterport.py`: floor plates measured from the scans |
| Matterport **API token** | `.env` → `MATTERPORT_API_TOKEN` | same (Matterport's names: API Token ID and Token Secret) |
| Vexcel **api_key** | `.env` → `VEXCEL_API_KEY` | aerial parking images (the download step needs Vexcel's quickstart) |
| Anthropic API key | `.env` → `ANTHROPIC_API_KEY` | the Claude agent (deepagents) and `count_cars.py` |
| Google Maps key or Cesium ion token, Mapillary token | `lightwell/config.js` | Photoreal 3D and street photos |

Copy `.env.example` to `.env` and `lightwell/config.example.js` to `lightwell/config.js`; both copies are git-ignored.
Restart the backend after editing `.env`. The CoStar data kit itself needs no key.
The first-hours plan for the hackathon is in [EVENT_DAY.md](EVENT_DAY.md). Real data files are git-ignored.

## Real vs simulated

| Real now | Simulated in demo mode, MISSING in real mode, until imported |
|---|---|
| Footprints, heights, floor-plate sizes (OpenStreetMap) | Occupancy, leases, year built (CoStar) |
| Street map (OpenFreeMap) | Parking counts (Vexcel) |
| Google photoreal city (with your key) | Interior scans: core, floor-to-floor (Matterport). Until then cores are ASSUMED and floor-to-floor is an ESTIMATE |
| Neighbour heights for Daylight X-ray (OpenStreetMap, 231 buildings) | 989 of 1,220 footprints have no OSM height: drawn at 8 m and tagged ESTIMATE until Vexcel heights are imported |

With the CoStar data kit imported, the downtown office towers it covers use real CoStar values (tagged COSTAR) for
leasing, year built, empty floors, sprinklers, slab-to-slab height and tenants; the other towers stay simulated (demo)
or MISSING (real data only). Real building names are hidden (towers show as HOU-01, HOU-02...) until real market data
is loaded, so an invented number is never attached to a real, named building. An occupancy dot is an observation to investigate, never an accusation.

## How it works

```
 You ask ──► brief ──► Planner (deepagents) ──► market-analyst ──► CoStar records, Vexcel counts, occupancy discrepancies
                               │             └─► feasibility-engineer ──► floor plates, daylight test, lightwell, cost, fire screen, daylight X-ray
                               ├─► review_evidence ──► request_measurement (you answer) ──► re-rank, explain the change
                               ├─► policy-analyst ──► Texas 65% fast-track per tower
                               ├─► deal-maker ──► tenants + leases ──► tenant moves, incentive cost, homes unlocked
                               ├─► red-team ──► objections; weak plan → next tower
                               └─► draft_owner_memo ──► reviewed result + corrections back to the page ──► you approve
```

- `lightwell/js/engine.js` and `backend/engine.py` are the same feasibility engine in JS and Python;
  `tests/parity.mjs` + `tests/test_engine.py` check they give identical numbers on every tower.
- Layout: cores are placed first; homes along each window wall are trimmed back to leave a 5 ft corridor at a core, and
  dropped if under 14 ft deep or 300 sq ft. Homes, cores and the courtyard never overlap (checked on every tower), and
  areas use the geometric union. With a lightwell, two new stair cores are assumed at opposite corners of the courtyard.
- The backend returns the reviewed numbers and any corrections; the page applies them and the memo renders from them.
- Score = daylight share 30% + vacancy 26% + cost per home 20% + ceiling height 6% + building age 8% + fire screen 10%.
  With Daylight X-ray on (the default), only homes whose windows see the sky count toward the daylight share; switch
  *Check daylight from neighbours* off in the brief and every number equals the plain window-distance test.
- A tower passes the brief when it is under the cost cap, has the minimum homes, has no likely fire blocker, has
  floor-to-floor of at least 10.5 ft, and has any real data the brief requires. The card says why a tower doesn't pass.
- Cost and carbon are planning estimates and are editable in the app: $255/sq ft conversion, $420/sq ft lightwell
  cut, $400k per new-build home, 500 kg CO2e/m2 new-build carbon, 60% avoided by reuse.

## Project layout

```
lightwell/              the app (open lightwell/index.html)
  js/engine.js          daylight test, lightwell, fire screen, cost, carbon, score
  js/data.js            OSM footprints -> candidate towers; applies real data
  js/views.js           MapLibre map view and CesiumJS / Google 3D view
  js/ui.js              panels, evidence drawer, floor plate, corrections, brief, checklist, memos, CSV
  js/agent.js           request -> brief; streams the backend agent (incl. questions), or runs the plan in the browser
  js/shuffle.js         Texas fast-track screen, tenants, tenant-move planner, red team
  js/intro.js           start screen: the Texas law and Houston's empty offices (sourced)
  config.example.js     copy to config.js for your keys
  consult.js            what the business we consulted asked for (Peri track); feeds the checklist and memo
  data/                 downtown Houston buildings (GeoJSON + .js copy for file://)
  data/daylight.js/.json  Daylight X-ray sky profiles per tower wall (from backend/daylight.py)
backend/
  agent.py              deepagents planner, sub-agents and tools
  engine.py             Python copy of engine.js
  shuffle.py            Python copy of shuffle.js
  daylight.py           Daylight X-ray precompute: neighbouring buildings seen from every wall
  app.py                FastAPI server streaming agent steps (SSE)
  import_data.py        joins real-data/*.csv to the map
  costar_kit.py         CoStar data kit -> real-data/costar.csv + tenants.csv
  matterport.py         Matterport Model API -> real-data/interiors.csv (floor plates from scans)
  env.py                loads keys from the project's .env
  count_cars.py         Claude vision car counter for aerial images
real-data/              CSV templates and column guide
tests/                  engine geometry + parity tests, backend review-and-replan test
EVENT_DAY.md            hackathon first-hours checklist
Lightwell-Project-Plan.pdf  project plan
lightwell.html, lightwell-houston.html, houston-map.html
                        earlier single-file prototypes, kept as offline backups
```

## Tracks

Best Sustainability Hack (main) · CoStar *AI for the Built World* · LangChain *Best use of deepagents* ·
Amazon *Best Practical AI Innovation* · Peri *Forward Deployed* · Arlequin *AI-Driven Forensics*

## Limits

Lightwell is a screening tool: it says where to look first. Daylight distances, fire rules and costs vary by city
and building; an architect, fire engineer and cost consultant make the final call. The fire screen is an estimate from
the plate and core rectangle (stairs and corridors are assumed), and an occupancy discrepancy is never evidence of
wrongdoing. Daylight X-ray is a screening check with an angle rule (after UK BRE daylight guidance), not a daylight
study: it ignores glazing, reflections, trees and anything not in the OSM footprints, and buildings without an OSM
height are drawn at 8 m.

## Credits

Map data © OpenStreetMap contributors (ODbL). Street tiles by OpenFreeMap. 3D by MapLibre GL and CesiumJS.
Photorealistic 3D Tiles © Google. Agent built with LangChain deepagents and Claude.
