# Devpost draft

A draft of the submission text. Edit freely. Fill the two `[…]` gaps (the Peri interview and the Vexcel line) with
what is true on the day, and delete this paragraph.

**Tracks to tick:** Best Sustainability Hack (required) · CoStar *Inside and Out* · LangChain *Best use of deepagents*
· Amazon *Best Practical AI Innovation* · Peri *Forward Deployed* (only after the interview) · Arlequin (team decision,
see `TRACKS.md`).

---

## Lightwell

**Find the empty offices that can become homes, and prove it from above, inside and on the books.**

### Inspiration

About one in four office desks in downtown Houston sits empty while the city needs homes. Since 1 September 2025,
Texas SB 840 and SB 2477 let an office building become homes without rezoning if at least 65% of it converts. Most
towers still can't: their floors are too deep for daylight, their tenants sit on scattered floors, and nobody knows
which building to look at first. We wanted an agent that answers that for a whole downtown in minutes.

### What it does

You ask in plain English: *"Find offices downtown I can turn into homes for under $300k a home."* A team of AI agents
then:

- reads **CoStar** records for each tower (leasing, empty floors, tenants and lease ends, year, sprinklers, sales);
- measures the inside from **Matterport** scans: the clear ceiling height decides the height test, so the agent stops
  asking for a measurement the scan already gives;
- tests every floor for daylight, tries cutting a courtyard (a *lightwell*) through deep floors, and checks each home's
  view of the sky against the real neighbouring buildings;
- runs a preliminary fire screen and the Texas 65% rule;
- plans which tenants could move to which nearby towers to unlock a building, and lets a red-team agent attack that plan;
- cross-checks the records and shows where two sources disagree;
- stops to ask you for the one measurement that would change its recommendation, then re-ranks;
- drafts an owner memo for you to approve, with the carbon avoided by reusing the tower.

Every number on screen carries a source tag (COSTAR, MATTERPORT, OSM, ESTIMATE, ASSUMED, MISSING, YOU), and one click
shows the evidence behind it.

### How we built it

- **Agent:** LangChain **deepagents** with Claude: a planner, six sub-agents (market, data scout, feasibility, policy,
  deals, red team) and 24 tools, served by FastAPI and streamed to the page. A second deepagent answers questions in
  the *Ask Lightwell* chat.
- **Engine:** the floor-plate, daylight, fire, cost and carbon maths is written twice, in JavaScript for the page and
  in Python for the agent, and tested to give the same numbers on every tower.
- **Data:** CoStar's hackathon data kit for 15 downtown towers and their tenants; the Matterport Model API for the
  scans; OpenStreetMap footprints and heights for about 1,200 buildings. [Vexcel: say here whether aerial images were
  loaded. The importer and the car counter are built.]
- **Views:** MapLibre for the 3D map, CesiumJS with Google Photorealistic 3D Tiles, Matterport's 3D tour, Google
  Aerial View flyovers.

### Challenges

- Honest data. Real records and estimates sit next to each other, so every field carries its own source tag and the
  agent tests what happens if an estimate is wrong.
- The scans. Most are one suite or a lobby, not a whole floor. We use only scans of office space, need 2,000 sq ft of
  them per building, and use what they truly measure (ceiling height and floor area) instead of guessing a floor plate.
- Keeping two engines identical. A parity test runs both on every tower in eight scenarios.

### What we are proud of

- The agent answers its own biggest question (is the floor tall enough?) from the inside of the building.
- A tenant-move plan that a second agent tries to break before you see it.
- It never calls a tower fire-safe and never accuses anyone: screens are called screens, and discrepancies are
  observations to investigate.

### What we learned

Combining layers is where the value is. A record, a scan and a footprint each look fine alone; put side by side they
show which towers are worth a visit and which records need checking.

### What's next

Vexcel parking counts over several capture dates as a third layer; floor plates measured from full-floor scans; more
cities.

### Who it is for

Building owners, brokers and city housing staff deciding which empty tower to look at first.

[Peri: "We consulted **[person], [role] at [business]**. They told us: *'[quote]'*. What they asked for now leads
every checklist and memo." Add the evidence.]

### Built with

Python, FastAPI, LangChain deepagents, Claude, JavaScript, MapLibre GL, CesiumJS, Google Photorealistic 3D Tiles,
Google Aerial View, Matterport, CoStar data, OpenStreetMap.
