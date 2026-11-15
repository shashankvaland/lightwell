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

# Ideas from Parikshit

Main target: **CoStar, Inside and Out** (30% data use · 30% agentic depth · 25% usefulness · 15% demo).
Required HackPrinceton track: **Sustainability**. Each idea below is tagged with the tracks it helps, and CoStar ideas
also list which data layers they combine (CoStar = market, Vexcel = aerial, Matterport = interior).
Ideas the app already has (brief, review-and-replan, evidence drawer, Empty floors view, consult checklist) are left out.

**Top picks:** 1, 2, 3, 4 and 5 for CoStar; 11 to close the pitch for Sustainability. See the summary table at the end.

---

## CoStar: Inside and Out (main track)

## 1. Floor-plan generator: "show me the actual homes"
**Added by:** Parikshit
**What:** Pick a home on the floor plate, drag a box over empty floor or select a whole floor, and say what you want
("2-bed family home", "as many studios as possible"). In under a second Lightwell proposes 3-5 real home plans with
rooms, furniture, sizes and cost, each with a one-line summary of its trade-off ("max light" / "family" / "cheapest").
- **How it fits a real building:** kitchens and bathrooms sit next to the core, because the water and drain pipes run
  up beside it. Bedrooms go on the window wall and bathrooms and closets fill the dark middle. Walls avoid columns and
  meet window frames. Every plan keeps the escape route within limit.
- **How it's built:** adjustable plan templates plus a fast rule check in JS (same style as `engine.js`). The agent
  turns plain words into rules, then picks the best plans and explains them. The AI never draws walls itself.
- **Output:** an SVG plan, a room table with daylight per room, cost, PDF/DXF export, and "early concept plan, not
  construction drawings" on every sheet.
- **Bonus:** home counts and costs then come from real plans instead of the fixed width pattern, so tower scores get
  more accurate.
**Data layers:** Matterport (plate, core, floor-to-floor) + CoStar (size, rent level).
**Why / which track it helps:** CoStar (spatial and visual, the "we didn't know you could do that" moment), Amazon,
Business. Suggested by a friend of the team.
**Effort:** medium for a first version (about 6 templates, 3 options per space), large for the full version

## 2. Read real floor plans from Matterport scans and broker floor-plan images
**Added by:** Parikshit
**What:** Today plates are a rectangle around the footprint and cores are ASSUMED. Pull the Matterport floor plan, or
the typical floor plan image from a leasing brochure, and use Claude vision to read out the core, stairs, columns,
which walls are glass and the plate shape (the same pattern as `count_cars.py`). The values arrive tagged MATTERPORT or
FLOOR PLAN instead of ASSUMED, and the plan image shows in the evidence drawer.
**Data layers:** Matterport + CoStar (address and floor size to find and check the plan).
**Why / which track it helps:** CoStar (uses the inside of the building, not just its numbers), and it feeds idea 1.
The review-and-replan step can then request a floor plan instead of a single number.
**Effort:** medium

## 3. Real sunlight, shaded by neighboring towers
**Added by:** Parikshit
**What:** "Daylit" now means "within 30 ft of a window". Use the real building heights we already have to cast shadows
from neighboring towers, and give each window wall, each floor and each home its hours of sun in winter. Add a
time-of-day slider in the 3D view with shadows sweeping across downtown. A low floor facing a taller tower loses homes;
a high corner floor gains.
**Data layers:** OSM heights + Vexcel (oblique images to confirm glass and heights) + Matterport (actual window walls).
**Why / which track it helps:** CoStar (spatial reasoning), Sustainability (daylight and passive heat),
Science + Discovery. Fixes the weakest assumption in the score.
**Effort:** medium-large

## 4. Vacancy forecast: who is leaving, and when
**Added by:** Parikshit
**What:** Today we compare reported occupancy with parked cars. Add CoStar lease data (tenant list, lease end dates,
space on the market or offered for sublease) together with the Vexcel parking trend across capture dates, to predict
how empty a tower will be in 12-24 months: "two anchor tenants roll in 2027, the lot is down 30% since 2024, likely
45% vacant." Towers about to empty out rank higher, because conversion is easiest before the next leases are signed.
**Data layers:** CoStar (leases, tenants, available space) + Vexcel (parking over time).
**Why / which track it helps:** CoStar (a combination of layers nobody does today), Business, Amazon.
**Effort:** medium

## 5. Rent and return check
**Added by:** Parikshit
**What:** The engine stops at cost per home, but owners decide on return. Add:
- expected rent from nearby apartment rents (CoStar has multifamily data and owns Apartments.com, so ask on site
  whether rent comparables are in the toolkit)
- operating costs, and yearly rent minus costs as a share of total cost
- a break-even rent
- incentives: Houston's Downtown Living Initiative (per-home payment; check the current terms) and the 20% federal
  historic tax credit for older towers

The card then reads "6.1% return with the incentive, 4.8% without".
**Data layers:** CoStar (rents, sale comparables) + engine cost.
**Why / which track it helps:** CoStar (usefulness for investors and lenders), Business and Enterprise.
**Effort:** medium

## 6. "What would make it work?" solver
**Added by:** Parikshit
**What:** For a tower that fails, the agent works backwards to the smallest change that flips it: "passes with a $22k
city incentive", "passes with a 40 ft lightwell", "passes if floors 2-8 stay office", "passes if construction cost is
under $240/sq ft". It tries the levers itself with the engine and returns the 2-3 cheapest paths.
**Why / which track it helps:** CoStar and LangChain (agentic depth: plans, tests options, acts), Amazon.
**Effort:** medium

## 7. Owners ready to say yes
**Added by:** Parikshit
**What:** Rank towers by how likely the owner is to sell or convert, not only by how good the building is. Signals: a
recent sale at a discount, a long hold, big lease endings (idea 4), and a loan coming due (if CoStar has it). The memo
opens with "why this owner, why now".
**Data layers:** CoStar (sales, ownership, leases) + Vexcel (activity trend).
**Why / which track it helps:** CoStar, Business. Brokers would want this switched on Monday.
**Effort:** small-medium

## 8. Los Angeles, one click
**Added by:** Parikshit
**What:** The sponsor dataset covers Houston **and** Los Angeles. Make the city a setting: OSM footprints, map center
and local cost, rent and fire assumptions per city. Same agent, second city. LA adds a real policy hook (its Adaptive
Reuse Ordinance).
**Why / which track it helps:** CoStar (uses more of their data, shows the tool generalizes), Sustainability.
**Effort:** medium

## 9. Walk through the "after" inside the Matterport scan
**Added by:** Parikshit
**What:** From a proposed home, open the Matterport tour at that spot on that floor, with the planned walls and room
names drawn over the real interior (Matterport's SDK supports tags and overlays; confirm on site). Today's empty
office and tomorrow's living room, in the same 3D view.
**Data layers:** Matterport + our layout.
**Why / which track it helps:** CoStar (demo 15%, spatial and visual), Entertainment.
**Effort:** medium-large

---

## Sustainability (required HackPrinceton track)

## 10. Full carbon story
**Added by:** Parikshit
**What:** Today we count the embodied carbon avoided. Add operating energy before and after conversion, heat gain
through west-facing glass in Houston, and everyday equivalents: "same as taking 1,400 cars off the road for a year".
Show a per-tower and a whole-portfolio carbon card.
**Why / which track it helps:** Sustainability, CoStar (memo quality).
**Effort:** small-medium

## 11. City-wide impact and incentive curve
**Added by:** Parikshit
**What:** Total up every tower that passes: homes added, CO₂ avoided, new downtown residents. Add a slider for the
city's incentive per home and a curve of homes unlocked, so a planner can see where each extra dollar of incentive gets
the most homes. Good closing slide for the pitch.
**Why / which track it helps:** Sustainability, CoStar (city planner as user), Business.
**Effort:** medium

## 12. Rooftops and parking lots from above
**Added by:** Parikshit
**What:** Use Vexcel aerial images to measure each tower's roof (usable area, equipment, shade from neighbors) for
solar panels, a green roof or a residents' terrace. Mark nearby surface parking that converted towers no longer need
as space for pocket parks or more homes.
**Data layers:** Vexcel + CoStar (parking ratio).
**Why / which track it helps:** Sustainability, CoStar (Vexcel used for more than counting cars).
**Effort:** medium

## 13. Climate risk check (flood, heat, power)
**Added by:** Parikshit
**What:** Add FEMA flood zones (ground floors and basement equipment, relevant since Hurricane Harvey), heat exposure,
and a backup-power note (the 2021 winter storm blackout). Each becomes a line in the fire and risk screen, plus an
item on the "before a site visit" checklist.
**Why / which track it helps:** Sustainability, Healthcare (safe homes).
**Effort:** small-medium

---

## Amazon Practical AI · Business and Enterprise

## 14. Watchlist and alerts
**Added by:** Parikshit
**What:** Add towers to a watchlist. When a new Vexcel capture, a CoStar lease change or a sale arrives, the agent
re-runs that tower and notifies you: "HOU-12 moved from 61 to 74: anchor tenant gave notice." An agent that keeps
working after the demo.
**Why / which track it helps:** Amazon (takes action, adapts), CoStar (switched on Monday), Business.
**Effort:** medium

## 15. Learns your preferences
**Added by:** Parikshit
**What:** Remember each user's past briefs, corrections and approvals: "you always reject towers under 11 ft
floor-to-floor; I've applied that." Show the learned rules and let the user remove any of them.
**Why / which track it helps:** Amazon (adaptive intelligence), LangChain (deepagents memory).
**Effort:** small-medium

## 16. Deal room: scenarios, compare, share
**Added by:** Parikshit
**What:** Save scenarios (brief + assumptions + corrections), compare towers side by side, and share a read-only link
or a one-page broker teaser PDF.
**Why / which track it helps:** Business and Enterprise, Amazon (user experience), CoStar (demo polish).
**Effort:** medium

## 17. "Live here" card for residents
**Added by:** Parikshit
**What:** For a sample home: rent, hours of winter sun, the view, a walk to the nearest grocery store and park, and
travel time to rail and the Texas Medical Center. It flags gaps such as "900 new residents, no grocery store within 10
minutes."
**Why / which track it helps:** Amazon (real people), Sustainability (walkable living), Healthcare.
**Effort:** small-medium

---

## LangChain: Best use of deepagents

## 18. More specialist sub-agents and a visible plan tree
**Added by:** Parikshit
**What:** Add a finance analyst (idea 5), an architect (idea 1), a policy analyst (incentives, LA rules) and a climate
analyst (idea 13) next to the current market and feasibility sub-agents. Use deepagents' to-do list and file system
for working notes, and show the live plan tree in the UI so judges can watch it plan, delegate and revise.
**Why / which track it helps:** LangChain, CoStar (agentic depth 30%).
**Effort:** medium

## 19. "Skeptical lender" reviewer
**Added by:** Parikshit
**What:** Before a memo is shown, a separate sub-agent plays a tough lender and challenges it: weakest assumption,
missing evidence, optimistic rent. The planner must answer or fix each point, and the memo lists them under "Questions
a lender will ask".
**Why / which track it helps:** LangChain, CoStar (trust), Business.
**Effort:** small-medium

---

## Arlequin: AI-Driven Forensics

Keep the existing rule: these are observations to investigate, never accusations.

## 20. Record consistency checks
**Added by:** Parikshit
**What:** Cross-check one source against another for the same building: CoStar floor area against Matterport plates ×
floors, reported floors against measured height, "100% leased" against an empty lot across three captures, advertised
space against reported occupancy. Score each discrepancy and explain it.
**Data layers:** all three.
**Why / which track it helps:** Arlequin, CoStar (data quality is useful to them too).
**Effort:** medium

## 21. Evidence chain for occupancy findings
**Added by:** Parikshit
**What:** For each flag, a timeline of every capture (weekday vs weekend, car counts, confidence), aerial images side
by side, a log of who corrected what and when, and a fingerprint (hash) of every image so the evidence can't change
silently. Ends with "why this might be wrong" (event day, garage parking, remote work).
**Why / which track it helps:** Arlequin, CoStar (evidence drawer becomes audit-ready).
**Effort:** small-medium

---

## Peri: Forward Deployed

## 22. Build the deliverable the consulted business actually uses
**Added by:** Parikshit
**What:** `consult.js` already puts their checklist first. Go one step further: after the interview, match their real
workflow, for example their spreadsheet columns, the email they send owners or the one-pager they print for site
visits, and add that export. Reserve one feature slot for whatever the broker or property manager asks for.
**Why / which track it helps:** Peri (usable immediately), CoStar (usefulness).
**Effort:** small, depending on the ask

---

## Science + Discovery · Hardware (optional)

## 23. Check the score against towers already converted
**Added by:** Parikshit
**What:** Add the downtown towers that have already been converted to homes and check whether Lightwell would have
ranked them high. Show the hit rate. This is the strongest proof that the scoring works.
**Why / which track it helps:** Science + Discovery, CoStar (credibility), Business.
**Effort:** small-medium

## 24. Site-visit light meter (stretch)
**Added by:** Parikshit
**What:** A small Raspberry Pi or ESP32 with a light sensor and a laser rangefinder. On a site visit, it measures real
daylight and depth at points on the floor and sends them straight to `request_measurement`. The agent re-ranks live:
the physical world answers the agent's question.
**Why / which track it helps:** Hardware, Physical AI, CoStar (a measurement loop no one else will have).
**Effort:** medium, and only if someone wants to do hardware

---

## Summary

| # | Idea | Main track | Also helps | Effort |
|---|---|---|---|---|
| 1 | Floor-plan generator | CoStar | Amazon, Business | M → L |
| 2 | Real floor plans (Matterport + vision) | CoStar | LangChain | M |
| 3 | Shadow-aware sunlight | CoStar | Sustainability, Science | M-L |
| 4 | Vacancy forecast | CoStar | Business, Amazon | M |
| 5 | Rent and return check | CoStar | Business | M |
| 6 | "What would make it work?" solver | CoStar | LangChain, Amazon | M |
| 7 | Owners ready to say yes | CoStar | Business | S-M |
| 8 | Los Angeles | CoStar | Sustainability | M |
| 9 | Walk the "after" in Matterport | CoStar | Entertainment | M-L |
| 10 | Full carbon story | Sustainability | CoStar | S-M |
| 11 | City-wide impact and incentive curve | Sustainability | CoStar, Business | M |
| 12 | Rooftops and parking lots | Sustainability | CoStar | M |
| 13 | Climate risk check | Sustainability | Healthcare | S-M |
| 14 | Watchlist and alerts | Amazon | CoStar, Business | M |
| 15 | Learns your preferences | Amazon | LangChain | S-M |
| 16 | Deal room | Business | Amazon | M |
| 17 | "Live here" card | Amazon | Sustainability, Healthcare | S-M |
| 18 | More sub-agents and plan tree | LangChain | CoStar | M |
| 19 | "Skeptical lender" reviewer | LangChain | CoStar, Business | S-M |
| 20 | Record consistency checks | Arlequin | CoStar | M |
| 21 | Occupancy evidence chain | Arlequin | CoStar | S-M |
| 22 | Consulted-business deliverable | Peri | CoStar | S |
| 23 | Check against converted towers | Science | CoStar, Business | S-M |
| 24 | Site-visit light meter | Hardware | CoStar | M |

**Suggested order for the hackathon:** 2 → 4 → 6 → 1 (first version) → 5 → 11, then small extras (19, 10, 21) as time
allows. Ideas 2 and 4 come first because they make the best use of the data layers (30% of the CoStar score). 6 and 19
add agentic depth (30%), 1 and 3 make the demo, and 11 closes the pitch.

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
