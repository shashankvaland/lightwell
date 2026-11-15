# Real data drop-in

The app and the agent read real values from four CSVs in this folder (all git-ignored: the data is licensed to the
team). Any file can be missing; that layer stays simulated in demo mode and MISSING in real mode.

```
real-data/costar.csv      one row per building
real-data/tenants.csv     one row per current tenancy (tenant moves)
real-data/rents.csv       one row per rental listing near downtown (rent check), from backend/rent_comps.py
real-data/parking.csv     one row per building per aerial capture
real-data/interiors.csv   one row per building with a Matterport measurement (ceiling height, scan area)
```
After changing any of them, from the project folder:
```
python backend/import_data.py
```
It matches every row to a real OpenStreetMap footprint, prints a match report, and writes
`lightwell/data/real_overlay.js` (+ `.json`). Reload the page.

## CoStar data kit (HackPrinceton)

The kit CoStar gave the team (`costar-hackathon-kit/`, with `index.md`, `data/*.jsonl`, `schemas/`) fills `costar.csv`
and `tenants.csv` for every downtown Houston office tower it covers. Keep the kit next to the project folder, or set
`COSTAR_KIT_DIR` in `.env`, then:
```
python backend/costar_kit.py      # -> real-data/costar.csv + real-data/tenants.csv, with a report per tower
python backend/rent_comps.py --show  # which rent columns the kit has (writes nothing)
python backend/rent_comps.py      # -> real-data/rents.csv: asking rents near downtown for the rent check
python backend/import_data.py     # -> lightwell/data/real_overlay.js
```
What it does (details in the script's docstring):
- **Towers:** Office properties in CoStar's Houston market inside the map, 6+ storeys.
- **Footprint:** street address and name first, then the point inside a footprint, then height and size; each footprint
  is used once. OpenStreetMap often has a wrong height for a tower (a 56-storey tower mapped at 40 m): then CoStar's
  height, or storeys x 13 ft (tagged ESTIMATE), replaces it.
- **Percent leased** = 100% - vacant direct space on the market now / RBA (CoStar's formula; sublet and future space is
  available, not vacant). It agrees with the share leased at each tower's latest sale where there is a recent one. A
  tower with no listing and no tenant uses the share leased at its latest sale.
- **Empty floors:** floors whose vacant direct space covers 80%+ of the typical floor, or a full-floor space; every
  floor of a tower reported empty. `none` means known to have no empty floor.
- **Floor-to-floor:** CoStar's slab-to-slab height when it agrees with the building's height (within 2.5 ft a storey);
  otherwise the estimate stays and `f2f_note` says why, so the agent can ask for the measurement.
- **Sprinklers** (the fire screen prices a retrofit only when there are none), year built and renovated, class and
  rating, parking spaces, the CoStar photo link and the Matterport model ids.
- **Converted buildings:** a building CoStar marks as converted (with the apartment community now on its footprint)
  never passes.
- **Tenants:** current tenancies on known office floors, named from the company records. CoStar has a lease end for
  only some of them; a blank lease end is "not on record" and costs the `unknownLeaseYrs` assumption in tenant moves.
  Tenant moves that name real companies are hypothetical plans, labelled as such in the app.

## Matterport scans (floor plates)

CoStar's Matterport model ids are in `costar.csv` (`matterport_models`); the app's **3D tour** button opens them.
To measure floor plates from the scans, put the Matterport keys in `.env` (see the keys table in the main README), then:
```
python backend/matterport.py --dry-run     # what each scan covers; writes nothing
python backend/matterport.py               # -> real-data/interiors.csv, then run import_data.py
```
What a scan gives: the **clear ceiling height** of scanned office space, its floor area and how far the scan reaches.
The engine's height test uses the ceiling (tagged MATTERPORT) instead of the floor-to-floor estimate, and the agent no
longer asks you to measure a height the scan already settles. Lobbies, tunnels, gyms and unnamed scans are listed, not
used, and a building needs 2,000 sq ft of scanned office space. The API gives no plate width and depth for these scans,
so the plate stays the OpenStreetMap footprint; the scan area is shown next to CoStar's typical floor as a cross-check.

## Vexcel aerial counts (parking)

`VEXCEL_API_KEY` goes in `.env`. The Vexcel image download needs the request format from Vexcel's quickstart (the
"Getting started (PDF)" and "Quickstart (Python)" links on the CoStar Discord card), which is behind Vexcel's login.
Until that step is added, save a lot image from the Vexcel viewer and count it:
```
python backend/count_cars.py lot.jpg --costar-id 1234567 --date 2026-11-14 --dry-run   # check by eye, then drop --dry-run
```
`costar.csv` has each tower's `parking_spaces` from CoStar for comparison.

## Columns

**costar.csv** (the first eleven columns are the original template; `costar_kit.py` adds the rest)
| column | meaning | example |
|---|---|---|
| costar_id | CoStar property id (the join key for the other files) | 1234567 |
| address | street address | 1000 Main St |
| lat, lon | building location (WGS84). Needed to find the footprint | 29.7579, -95.3632 |
| property_type | Office, Retail, ... (non-office rows are ignored) | Office |
| leased_pct | percent leased, 0-100 | 72 |
| year_built | year | 1981 |
| rba_sqft | rentable building area | 850000 |
| floors | storeys (used if the map has no height) | 36 |
| owner | owner name (goes into the memo) | |
| vacant_floors | empty floors, ranges allowed; `none` = known to have none; blank = unknown | 3-7;12;20-22 |
| osm_id, match | the OpenStreetMap footprint chosen, and how | 12345678, address |
| building_name, building_class, star_rating | shown on the card (the name replaces HOU-xx) | Main Tower, A, 4 |
| year_renovated | latest renovation | 2015 |
| height_m, height_src | replaces a missing or implausible map height (COSTAR or ESTIMATE) | 150, COSTAR |
| typical_floor_sqft | CoStar's typical floor | 24000 |
| floor_to_floor_ft, f2f_note | slab-to-slab when it passes the height check; the check | 13 |
| sprinklers | yes / no / blank (unknown) | yes |
| parking_spaces | CoStar's total spaces | 500 |
| converted_year, converted_to | CoStar's conversion record | 2020, Main Lofts (apartments) |
| photo_url, matterport_models | CoStar photo link; Matterport model ids, `;`-separated | |
| leased_method, leased_tenancy_pct, sale_leased_pct, sale_date, available_sqft, vacant_now_sqft, tenants_current, tenants_with_lease_end | how leasing was worked out, shown in the evidence drawer | |

**tenants.csv**
| column | meaning |
|---|---|
| costar_id | building |
| tenant | company name from CoStar's company records ("Unidentified tenant" when CoStar has none) |
| floors | office floors, ranges allowed (`24-27;31`) |
| sqft, sqft_estimated | space occupied; `true` when CoStar has no area and it was estimated from the typical floor |
| lease_end, lease_end_date | year and month the lease ends, when on record and in the future; blank = not on record |
| lease_type, industry, source | Direct / Sublease / Owner..., the tenant's industry, `costar` |

**parking.csv** (Vexcel: count cars yourself, or run `backend/count_cars.py` on an aerial image)
| column | meaning |
|---|---|
| costar_id | which building the lot serves |
| capture_date | date of the aerial image, YYYY-MM-DD |
| spaces_total, cars_counted | integers |
| source | `vexcel`, `vexcel+claude` or `manual` |
| confidence | optional: `high`, `medium`, `low` (written by `count_cars.py`) |
| notes | optional: what limits the count (shadows, trees, a garage roof) |
| image_ref | optional: image file or Vexcel image id, shown in the evidence drawer |

**interiors.csv** (Matterport; `matterport.py` writes it)
| column | meaning |
|---|---|
| costar_id | building |
| scanned | true / false |
| plate_w_ft, plate_d_ft | typical floor width and depth |
| floor_to_floor_ft | slab-to-slab height (a scan's ceiling height is not this; leave empty) |
| core_x_ft, core_y_ft, core_w_ft, core_d_ft | core rectangle on that floor (from the plate's top-left corner); leave empty if unknown |
| matterport_model_id | the largest office scan |
| notes | optional: what the scans cover, shown in the evidence drawer |
| ceiling_ft | clear ceiling measured in scans of office space (the middle value by scanned area); decides the height test |
| ceiling_min_ft, ceiling_max_ft | lowest and highest office ceiling across the scans |
| scan_area_sqft, scan_extent_ft, scan_name | the largest office scan: floor area, how far it reaches (e.g. 200x120), its name |
| scans_measured | office scans that gave a ceiling height |

## How matching works
1. A row with `osm_id` (from `costar_kit.py`) uses that footprint.
2. Otherwise, if the point (lat, lon) falls inside an OpenStreetMap footprint, that's the building.
3. Otherwise the nearest footprint centre within 40 m is used, and the report marks it "nearest".
4. Rows that match nothing are listed so you can fix their coordinates.

Buildings with real CoStar data show their **name** (or address) instead of a HOU-xx code. Every value carries its own
source tag: a CoStar row with only a year built tags the year COSTAR and leaves leasing MISSING (it is never filled with
a simulated number). With an overlay loaded the app starts in **Real data only** mode; **Demo fill-in** simulates values
only on anonymous towers. Click any tag in the app to see the record behind it.
