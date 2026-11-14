# Real data drop-in

At the event, whatever shape the CoStar, Vexcel and Matterport APIs return, write a few lines that save it as these
three CSVs in this folder, then run the importer. The app and the agent pick the values up automatically.

```
real-data/costar.csv      one row per building
real-data/parking.csv     one row per building per aerial capture
real-data/interiors.csv   one row per scanned building
```
Copy the header-only files from `templates/`. Any file can be missing; that layer stays simulated.

Then, from the project folder:
```
python backend/import_data.py
```
It matches every row to a real OpenStreetMap footprint, prints a match report, and writes
`lightwell/data/real_overlay.js` (+ `.json`). Reload the page.

## Columns

**costar.csv**
| column | meaning | example |
|---|---|---|
| costar_id | CoStar property id (the join key for the other files) | 1234567 |
| address | street address (shown as the building name) | 1000 Main St |
| lat, lon | building location (WGS84). Needed to find the footprint | 29.7579, -95.3632 |
| property_type | Office, Retail, ... (non-office rows are ignored) | Office |
| leased_pct | percent leased, 0-100 | 72 |
| year_built | year | 1981 |
| rba_sqft | rentable building area | 850000 |
| floors | stories (used if the map has no height) | 36 |
| owner | owner name (goes into the memo) | |
| vacant_floors | floors with available space (CoStar available-space listings), ranges allowed | 3-7;12;20-22 |

**parking.csv** (Vexcel: count cars yourself, or run `backend/count_cars.py` on an aerial image)
| column | meaning |
|---|---|
| costar_id | which building the lot serves |
| capture_date | date of the aerial image, YYYY-MM-DD |
| spaces_total, cars_counted | integers |
| source | `vexcel`, `vexcel+claude` or `manual` |

**interiors.csv** (Matterport)
| column | meaning |
|---|---|
| costar_id | building |
| scanned | true / false |
| plate_w_ft, plate_d_ft | typical floor width and depth |
| floor_to_floor_ft | slab-to-slab height |
| core_x_ft, core_y_ft, core_w_ft, core_d_ft | core rectangle on that floor (from the plate's top-left corner); leave empty if unknown |
| matterport_model_id | for linking to the 3D tour |

## How matching works
1. If the point (lat, lon) falls inside an OpenStreetMap footprint, that's the building.
2. Otherwise the nearest footprint centre within 40 m is used, and the report marks it "nearest".
3. Rows that match nothing are listed so you can fix their coordinates.

Buildings with real CoStar data show their **address** instead of a HOU-xx code, and every value carries its real
source tag (COSTAR, VEXCEL, MATTERPORT) instead of SIMULATED.
