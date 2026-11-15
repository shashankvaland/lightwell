# Lightwell: feature ideas

Add your ideas below. Pull first (`git pull`), add your section at the bottom, then commit and push.

---

<!-- Copy this block for each idea:

## Idea title
**Added by:** your name
**What:** one or two sentences
**Why / which track it helps:** CoStar, LangChain, Amazon, Sustainability, Peri, Arlequin...
**Effort:** small / medium / large

-->

---

# Ideas from Sur

## 1. Daylight X-ray: do the windows actually see the sky?

**Added by:** Sur

**What:** Today a home counts as daylit if it is within 30 ft of a window, whatever that window looks at. Downtown, many
windows face another tower across a narrow street. Daylight X-ray checks every floor's window walls, and every
lightwell court, against the real neighbouring buildings.
- A home sees the sky if the obstruction angle in front of its window is 25° or less (a screening rule from UK BRE
  daylight guidance; brief slider 20–35°).
- **Score mode** (default): blocked homes lower the daylight score.
- **Strict mode** (toggle): blocked homes aren't counted at all.
- With the check off, every number equals today's.

**How it's built:**
- `backend/daylight.py` casts rays from each wall of every tower through the OSM footprints. It stores the obstruction
  angle every 10 ft of height in `lightwell/data/daylight.js`. It runs once, in about 2 seconds.
- Both engines check each home floor by floor. Lightwell courts are checked against the tower's own height.
- A **Daylight** map view colours each floor by how many of its homes see the sky, with lines to the blocking
  buildings.
- A card row and an evidence drawer explain each tower.
- A `check_daylight` agent tool.
- Sun shadows with a time slider in Photoreal 3D.

**Prototype result:**
- About a quarter of the homes we count (9,237 of 35,322) face a nearby building.
- HOU-36 has 150 of 154 homes facing a building.
- In strict mode only 1 of today's 4 passing towers still passes.
- It also caught HOU-08, a parking garage that slips into the candidates because its name contains "Tower".

**Why / which track it helps:**
- **CoStar:** spatial and visual; Vexcel heights and Matterport window positions plug straight in.
- **Sustainability:** daylight is the main reason offices can't convert.
- **LangChain / Amazon:** the new `check_daylight` agent tool.

**Effort:** large (about 6–7 h; minimum version about 3 h). The data script, both engines and the tests are already
prototyped and pass the JS/Python parity tests.

## 2. Plumbing reach check

**Added by:** Sur

**What:** Office towers have their water and drain pipes at the core (the restrooms), but every home needs a kitchen and
a bathroom. Homes far from the core need long drain runs, raised floors or a new riser cut through every slab, and
all of that costs money.
- For each home in the layout, measure the walk from its inner wall to the nearest core.
- Flag homes beyond an editable limit (default 30 ft, an assumption), and add a "new riser" cost per flagged stack of
  homes.
- **Floor plate:** far homes get a tint.
- **Card**, for example: "12 of 14 homes per floor reach the core pipes; 2 need a new riser".

**How it's built:**
- Engine only: `engine.js` + `engine.py`, reusing the walking-distance helper from the fire screen.
- Two new values in the Assumptions panel (limit and riser cost).
- Parity tests.
- When a Matterport core is loaded, the real core position is used.

**Why / which track it helps:**
- **CoStar:** a more honest cost per home, using the Matterport core.
- **Business.**

**Effort:** small–medium (about 2 h).

## 3. Facade check from aerial and street images

**Added by:** Sur

**What:** The engine assumes every outer wall is glass. Classify each tower's facade from images, then feed it into the
engine:

| Facade | What changes |
|---|---|
| Full-height glass curtain wall | daylight as today; flag old curtain walls for a recladding cost |
| Punched windows (window holes in a solid wall) | fewer daylit homes per wall, scaled by the glass share |
| Mostly solid wall | no homes on that wall |

Results are tagged with their source, and the image appears in the evidence drawer.

**How it's built:**
- `backend/facade.py`, copying the `count_cars.py` pattern: an image goes in, Claude vision returns the facade type,
  glass share and confidence as JSON.
- The JSON goes to `real-data/facade.csv`, then `import_data.py`, then the engine.
- Use Vexcel oblique aerial images (sponsor data) or Mapillary street images (open licence). Avoid Google Street View
  images, whose terms limit this kind of reuse.

**Why / which track it helps:**
- **CoStar:** reads the outside of the building, not just its numbers; a "we didn't know you could do that" moment.
- **Amazon:** vision plus agent.

**Effort:** medium (about 3–4 h).

## 4. Confidence meter

**Added by:** Sur

**What:** Every value already carries a source tag (COSTAR, VEXCEL, MATTERPORT, OSM, ESTIMATE, ASSUMED, SIMULATED,
MISSING). Turn the tags into one number per tower: how much of its score rests on measured data, weighted by each
input's weight in the score (daylight 30%, vacancy 26%, cost 20%, and so on).
- A badge such as "72% measured" on the ranking and the card.
- A brief option: "only towers at least 60% measured".
- The memo opens with it.

**How it's built:** a small function in `engine.js` / `engine.py` that maps each part of the score to the fields it
uses and their tags, a badge in `ui.js`, and a parity test.

**Why / which track it helps:**
- **CoStar:** shows exactly how much real data drives each answer, and data use is 30% of their judging.
- **Arlequin:** trust.
- **Business.**

**Effort:** small (about 1–2 h).

## 5. Freeway noise check

**Added by:** Sur

**What:** Downtown is ringed by freeways (I-45, I-69 and I-10). Noise matters far more for homes than for offices.
- Measure each wall's distance to the nearest freeway, using the same wall-by-wall setup as Daylight X-ray.
- Flag walls within an editable distance (default 300 ft) as needing better windows, and add a glazing cost for them.
- Show the flagged walls on the floor plate and the card, and draw the freeway lines on the map.

**How it's built:** extend `backend/daylight.py` to read OSM motorway lines (one extra export) and store a distance
per wall. The engine adds the glazing cost.

**Why / which track it helps:**
- **Sustainability / Healthcare:** healthier homes.
- **CoStar:** spatial.
- **Business:** cost realism.

**Effort:** small–medium (about 2 h, after Daylight X-ray).
