# Devpost submission: Lightwell

Ready to paste into Devpost. Before you submit, check the three items marked `[TO DO]`: the Peri interview,
the Vexcel line and the links. Delete this paragraph too.

**Tracks to tick:**
- Best Sustainability Hack (required)
- CoStar *Inside and Out: AI for the Built World*
- LangChain *Best use of deepagents*
- Amazon *Best Practical AI Innovation*
- MLH: Best Use of DigitalOcean · Best Use of MongoDB Atlas · Best Domain Name from GoDaddy Registry · Best .Tech Domain Name
- Peri *Forward Deployed* (only after the interview)
- Arlequin *AI-Driven Forensics* (team decision, see `TRACKS.md`)

**Tagline (Devpost limit: 200 characters):**
> An AI agent team that finds which of Houston's empty office towers can become homes, tests every floor for daylight, and proves it from the records, the scans and the sky.

---

## Lightwell

### From spreadsheets to bedsheets.

Downtown Houston has a skyline full of empty desks and a city full of people who can't afford a home.
Lightwell is a team of AI agents that decides which of those towers can become homes. It shows its evidence for every number.

---

## Inspiration: two crises, one skyline

**Houston has too much office space.**
- About **one in four** square feet of Houston office space sits empty: 25.2% at the end of 2025 (CBRE) and
  25.6% in Q3 2026 (Newmark). Downtown's rate is one of the highest in the country.
- In Q1 2026, Shell's lease of more than **500,000 sq ft** downtown expired, so the downtown market lost more
  occupied space than any other part of the city.
- The best new towers fill up while the older ones empty out. Owners are now **demolishing** office buildings
  because, in the words of one broker, *"land now outweighs the building."*

**Houston doesn't have enough homes people can afford.**
- **More than half** of Houston-area renters spend more than 30% of their income on rent (Rice University's
  Kinder Institute, *State of Housing* 2026).
- The average rent in the region was **$2,050 a month** in Q1 2026 (Houston Association of Realtors). The median
  household income is about $65,000 a year (US Census).

**The law changed: Texas SB 840 and SB 2477, in effect since 1 September 2025.**
- In Texas cities like Houston, an office building at least five years old can now become homes **by right**: no
  rezoning, no traffic study, no extra parking.
- The condition: at least **65%** of the building has to become homes.

So the empty towers can now legally become homes, and the city needs them. It is starting: downtown's One City
Centre, at 1021 Main Street, is being converted from offices into **553 homes**.

**But conversions happen one building at a time, after months of consultants.** Most towers never get looked at,
because nobody can say quickly which ones would work. Three things stand in the way:

1. **The floors are too deep.** A bedroom needs a window. In the middle of a typical downtown floor, the glass is 60
   to 120 ft away. **52 of the 58 downtown towers we mapped are more than 90 ft deep**, and on average only
   **47%** of a floor is close enough to a window for a bedroom.
2. **The tenants are in the way.** A tower that is 40% empty can't reach 65% homes while its tenants sit on
   scattered floors with long leases.
3. **Nobody trusts the numbers.** Occupancy records, floor heights and scans disagree. A wrong guess about
   floor-to-floor height can sink a whole project.

We built Lightwell to answer that first question for the whole of downtown in minutes:
***which tower should we look at first, and why?***

---

## What it does

You ask in plain English:

> *"Find offices downtown I can turn into homes for under $300k a home."*

A team of AI agents takes it from there, and you can watch every step live.

**1. It turns your words into a brief.**
The request becomes clear rules on screen: cost cap, minimum homes, how close a bedroom must be to a window,
whether a courtyard can be cut, and which data must be real. The agent can change the brief itself, and it says so
when it does.

**2. It reads the market and the building.**
- **CoStar** records give each tower's leasing, empty floors, tenants and lease ends, year built, sprinklers and
  sale history.
- **Matterport** 3D scans measure the clear ceiling height *inside* the building.
- **OpenStreetMap** gives the real footprints and heights of 1,220 downtown buildings.

**3. It tests every floor of all 58 office towers.**
- It lays out homes on each floor plate, keeping only those where the bedroom is within about 30 ft of a window.
- Where the floor is too deep, it **cuts a lightwell**: a courtyard carved down through the middle of the floor to
  bring daylight to the core. Then it re-runs homes, cost and score.

**4. Daylight X-ray.**
- A window that faces a wall isn't really a window. Lightwell checks every window wall, floor by floor, against the
  real neighbouring buildings and shows how much sky each one sees.
- Red lines point to the building that blocks the light.
- In Photoreal 3D you can play real sun shadows for any hour on 21 December or 21 June.

**5. It runs a preliminary fire screen.**
- It estimates the walk from the farthest home to a stair, the distance between stairs, and whether sprinklers need
  adding.
- It says what is measured, what is assumed, and what still needs a fire engineer. It never calls a tower fire-safe.

**6. It checks the Texas 65% rule, then plans the tenant moves that unlock a tower.**
- For each tower it counts the floors needed for 65% homes and the floors empty today.
- When a tower falls short, a **deal-maker agent** picks the tenants whose leases end soonest and moves them into
  nearby half-empty offices. It prices the incentives, and gold arcs on the map show every move.
- Then a **red-team agent** attacks the plan: leases too long, moves too far, data not verified. If the plan breaks,
  the planner moves on to the next tower.

**7. It checks the rent.**
For every tower, Lightwell works out the monthly rent each new home needs to pay back its conversion, and sets it
against **real CoStar asking rents** within 1.2 km. It shows:
- whether the market covers it, nearly covers it or falls short;
- the most the market can pay to build each home;
- the household income needed to afford it, compared with Houston's median income.

**8. It asks you for the one measurement that matters, then replans.**
- For every estimated or assumed number on the shortlist, it tries a worse plausible value and checks whether the
  decision would change.
- If one would, it stops and asks you for that single measurement, then re-ranks and explains what changed:

  > *"HOU-53 now fails: floor-to-floor under 10.5 ft. New leader: HOU-34."*

- Where a Matterport scan already measured the ceiling, it doesn't ask at all: *"settled without a site visit."*

**9. It fills the gaps without inventing data.**
- CoStar covers only some towers. A **data-scout agent** estimates occupancy for the rest from the most similar
  CoStar towers, with a range, a confidence level and the towers it used.
- Every estimate is labelled ESTIMATE, never passed off as real.
- It also ranks **which towers to ask CoStar about next**: the ones where missing data would flip the decision.

**10. It cross-checks the records.**
- Where two independent sources disagree (CoStar leasing against the tenant list, a recorded floor height against
  the scanned ceiling, occupancy at the last sale against occupancy now), it shows both sources and both values.
- These are observations to investigate, never accusations.

**11. It shows you the homes, not just the numbers.**
- Click any home on a floor plate and the **home designer** offers 3 to 5 concept apartment plans: rooms,
  furniture, sizes and plumbing notes.
- Every plan is checked: no bedroom without a window, no room under the minimum size.
- Merge two neighbouring homes into one family-sized home.
- You can also take the **Matterport 3D tour** inside the real building and watch a **Google aerial flyover** of it.

**12. You stay in charge.**
- Correct any value and the agent re-ranks.
- **Ask Lightwell**, a chat built into the dashboard, answers questions like *"Why is the top pick #1?"*,
  *"Compare the top two"* or *"What if the cap were $350k?"* (with an *Apply* button).
- The agent drafts an **owner memo**. You approve it, and it is marked *not reviewed* the moment any input changes.
- Lightwell remembers your brief and corrections on your next visit, and the team's runs are saved to a shared
  history.

**Every number on screen carries a source tag:** COSTAR, MATTERPORT, OSM, ESTIMATE, ASSUMED, SIMULATED, MISSING or
YOU (a value you entered yourself). Click a tag to see the evidence behind it.

---

## What you get out of it

For the top tower in our demo run (HOU-53, a 12-storey downtown office tower):

| | |
|---|---|
| Homes | **110** (66 studios, 44 one-bed) |
| Share of the floor with daylight for bedrooms | **74%** |
| Cost per home | **$245k**, against about $400k to build new |
| Embodied carbon avoided by reusing the tower | **about 2,900 tonnes CO2e** (an estimate; the assumptions are editable) |
| Rent each home needs to pay back the conversion | **about $2,010 a month** |
| Texas fast-track | floors needed for 65% homes, floors empty now, and the tenant moves to close the gap |
| Ready to hand over | owner memo, "before a site visit" checklist, CSV with a source column for every field |

Across all 58 downtown towers, the floor plates hold room for about **35,000 homes** with a bedroom near a window.
Reusing those towers instead of building new would avoid roughly **1.3 million tonnes CO2e** of embodied carbon. Both
are upper-bound screening estimates: cost, tenants and the fire screen narrow them to a short list.

### Who it's for

- **Building owners and lenders** with a half-empty tower and a loan coming due: *convert, sell or demolish?*
  Lightwell answers in minutes and shows its working.
- **Brokers and developers** looking for the next conversion: a ranked shortlist with the tenant moves and the rent
  check already done.
- **City housing staff**: which towers could deliver homes under SB 840, how many, and what incentive would close
  the gap.
- **CoStar's own users**: a way to see what a building could *become*, not just what it is.

---

## How we built it

**The agents: LangChain deepagents + Claude**
- A **planner** built with `create_deep_agent`, with **six sub-agents**: market-analyst, data-scout,
  feasibility-engineer, policy-analyst, deal-maker and red-team.
- **25 tools**: ranking, daylight, fire, the 65% rule, tenant moves, the rent check, evidence review, owner memo and
  more.
- The planner can pause mid-run to ask a human a question, then replan from the answer.
- **Ask Lightwell** is a second deepagent with the same tools.
- Served by **FastAPI**, with every step streamed live to the page (server-sent events).
- With no API key, the same tools run in a fixed order, and the browser has its own offline agent. The demo never
  depends on the network.

**The engine: written twice, tested to match**
- The floor-plate, daylight, fire, cost, carbon, tenant-move, scout and rent maths runs in **JavaScript** (the page)
  and in **Python** (the agent).
- A parity test checks that both give identical numbers on every tower in eight scenarios.
- A separate test runs every apartment plan on every home of every tower.

**The data**
- **CoStar** hackathon data kit: downtown office towers, tenants and leases, sales and asking rents, converted into
  our format by our own importer.
- **Matterport** Model API: clear ceiling height and floor area from CoStar's scans.
- **OpenStreetMap**: 1,220 footprints and heights. A precomputed sky profile for every wall of every tower powers
  Daylight X-ray.
- `[TO DO]` **Vexcel**: say whether aerial images were loaded. Built and ready: the parking importer and a
  Claude-vision car counter that turns a parking-lot image into an occupancy signal.

**The views**
- **MapLibre GL** for the 3D map.
- **CesiumJS** with **Google Photorealistic 3D Tiles** for the real city, with real sun shadows.
- **Matterport** 3D tours and **Google Aerial View** flyovers.

**Live on the web**
- One **Docker** image runs on **DigitalOcean** App Platform and serves both the site and the agent API.
- **MongoDB Atlas** stores every run as the team's shared history. An Atlas aggregation shows which towers keep
  coming out on top across everyone's briefs.

---

## Challenges we ran into

- **Honest data.** Real records, estimates and gaps sit side by side, so we tagged every *field*, not every
  building. Real building names appear only next to real CoStar data, and a made-up number never sits beside a real
  name.
- **Scans aren't floor plans.** Most Matterport scans cover one suite or a lobby. We use only scans of office space,
  require 2,000 sq ft of them per building, and use what they truly measure (ceiling height and floor area) instead
  of guessing a floor plate.
- **Daylight is 3D.** A window 20 ft from a bedroom is useless if a tower stands 40 ft away. We precomputed what
  every wall of every tower can see, so the check runs instantly in the browser.
- **Two engines, one answer.** Every rule had to give the same number in JavaScript and Python, down to the
  rounding.
- **An agent that knows when to ask.** Asking about everything is useless, and so is asking about nothing. The agent
  asks only when the answer would change the decision.

---

## Accomplishments we're proud of

- The agent settles its own biggest unknown, *"is the floor tall enough?"*, from inside the building, using
  CoStar's records and Matterport's scans together.
- A tenant-move plan that a second agent tries to break before you ever see it.
- A rent check that uses only real CoStar asking rents. With no rents loaded it says so instead of inventing them.
- It never calls a tower fire-safe and never accuses anyone. Screens are called screens, and discrepancies are
  observations.
- It works end to end without an API key, and gets smarter with one. The demo never depends on an AI service
  being up.

---

## What we learned

- **Combining layers is where the value is.** A record, a scan and a footprint each look fine on their own. Side by
  side, they show which towers are worth a site visit and which records need checking.
- **Trust comes from showing the working.** People believed the agent more when it said *"this is an estimate,
  and here's what would change if it's wrong."*
- **Housing is a geometry problem first.** Before money or law, the question is whether a bedroom gets a window.

---

## What's next

- **Vexcel parking counts** over several capture dates, as a third, independent read of occupancy.
- **Full-floor scans** to measure floor plates directly instead of from the footprint.
- **More Texas cities.** SB 840 covers Dallas, Austin and San Antonio too, so the same agent works there with
  their data.
- **A solver** that finds the smallest change (incentive, rent, lightwell) that makes a failing tower pass.

---

## Who we talked to

`[TO DO]` We consulted **[person], [role] at [business]**. They told us: *"[quote]"*. What they asked for now
leads every "before a site visit" checklist and owner memo. Add the evidence: a photo, screenshot or short video.
*Delete this section if the interview didn't happen.*

---

## Built with

Python · FastAPI · LangChain deepagents · Claude (Anthropic) · JavaScript · MapLibre GL · CesiumJS · Google
Photorealistic 3D Tiles · Google Aerial View · Matterport · CoStar · OpenStreetMap · Docker · DigitalOcean ·
MongoDB Atlas

## Try it

- Live: `[TO DO]` https://spreadsheetstobedsheets.co (or the `.ondigitalocean.app` link)
- Code: https://github.com/shashankvaland/lightwell

---

## Sources

- Office vacancy: [CBRE Houston Office Q4 2025](https://mktgdocs.cbre.com/2299/c96e5094-5c69-4ad9-af7c-6f3f0b66728d-369846707/CBRE_Houston_Office_Figures_Q4.pdf) (25.2%); [CRE Daily on Newmark Q3 2026](https://www.credaily.com/?p=224274) (25.6%)
- Shell's downtown lease expiry: [Partners Houston Office Q1 2026](https://partnersrealestate.com/research/houston-office-q1-2026-quarterly-market-report/)
- Demolitions: [CRE Daily, "Houston's Office Reset Is Fueling a Demolition Boom"](https://www.credaily.com/?p=219743)
- Rent burden: [Rice University Kinder Institute, State of Housing 2026](https://news.rice.edu/news/2026/kinder-state-housing-report-finds-growing-number-residents-financially-squeezed)
- Average rent and median income: [ABC13 on the HAR affordability study, July 2026](https://abc13.com/post/despite-slightly-lower-rent-prices-expert-says-houstons-affordability-remains-a-real-issue/19603651/)
- The law: [Foley client briefing on SB 840 and SB 2477](https://www.foley.com/?p=116251)
- One City Centre: [The Real Deal](https://therealdeal.com/texas/houston/2025/08/15/3l-real-estate-plans-office-to-residential-for-houston-tower); [TDLR project record](https://www.tdlr.texas.gov/TABS/Search/Print/TABS2025025699)
- Embodied carbon of reuse (53-75% avoided): [Historic England](https://historicengland.org.uk/research/heritage-counts/heritage-and-environment/avoiding-embodied-carbon-production)
- Tower counts, depths, daylight shares, homes and carbon: computed by Lightwell from OpenStreetMap footprints, with
  the default assumptions shown in the app

*Lightwell is a screening tool. It tells you where to look first. An architect, a fire engineer and a cost
consultant make the final call.*
