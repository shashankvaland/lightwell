# Event day: getting real data into Lightwell

Goal for the first 3 hours: 10-20 real downtown Houston office towers with CoStar data, at least one aerial capture
each, and a few Matterport scans, showing in the app with real source tags.

## Hour 0-1: access and questions
- [ ] Get your CoStar, Vexcel and Matterport keys. Call each once and save one raw response to a file.
- [ ] Ask the CoStar engineers:
  1. How do I list **office** buildings in a Houston bounding box (downtown, roughly 29.747-29.768 N, 95.353-95.379 W)?
  2. Which fields hold **percent leased**, **year built**, **stories**, **RBA**, **owner**, **lat/lon**?
  3. Is the toolkit an SDK, an MCP server or an OpenAPI service, and which is fastest to call from Python?
- [ ] Ask the Vexcel engineers: how do I get an image **clipped to one building's parking lot**, and which
      **capture dates** exist for downtown Houston? Two or three dates is enough.
- [ ] Ask the Matterport engineers: which downtown Houston buildings have scans, and can I read a floor's
      **width, depth, ceiling height and core position** (or at least the floor plan image)?
- [ ] Ask Arlequin if the hidden-vacancy signals count for the forensics track.

## Hour 1-2: fill the three CSVs
Copy `real-data/templates/*.csv` into `real-data/`. Write a short script per API that saves rows in that format
(columns in `real-data/README.md`). Start with CoStar: it's the join key for everything else.

- **CoStar → costar.csv.** Office rows only. lat/lon are what match the row to a map building.
- **Vexcel → parking.csv.** For each lot image:
  ```
  python backend/count_cars.py lot.jpg --costar-id 1234567 --date 2026-06-10 --dry-run
  ```
  Check a few counts by eye; then drop `--dry-run` to append to `real-data/parking.csv`.
- **Matterport → interiors.csv.** Plate width and depth are enough; add the core rectangle if you can read it.

## Hour 2-3: import and check
```
python backend/import_data.py
```
- [ ] Read the match report. Fix any **NO MATCH** rows (usually lat/lon swapped or a garage point instead of the tower).
- [ ] Reload the page. The left note should count your real towers, and their cards should show COSTAR / VEXCEL /
      MATTERPORT tags and the street address instead of HOU-xx.
- [ ] Run the agent. Its CoStar / Vexcel / Matterport steps say how many towers are real.

## Rules we keep
- Real names appear **only** next to real CoStar data. Never put a simulated number next to a real name.
- A hidden-vacancy dot is a **signal to verify**, never an accusation. The card says so; keep it that way in the pitch.
- Keys go in environment variables or `lightwell/config.js`, never into git or chat.

## If something doesn't arrive
| Missing | Fallback |
|---|---|
| CoStar API | Keep simulated market data; the demo still runs on real footprints |
| Vexcel images | Leave parking.csv empty; those towers stay SIMULATED for aerial |
| Matterport scans | Plates come from real footprints (tagged OSM/ESTIMATE) |
| Google 3D key | Photoreal button shows OpenStreetMap buildings in 3D |
| Anthropic key | Backend runs the fixed plan; offline browser agent as last resort |
