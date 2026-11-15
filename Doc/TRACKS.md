# Tracks: what each one asks for and where Lightwell answers it

Written for the team before judging. Each section lists the track's own criteria, what to show, and what is still
open. Nothing here is a claim the app cannot back up on screen.

## Status at a glance

| Track | Status | Still needed |
|---|---|---|
| Best Sustainability Hack (required) | ready | say "estimate" when quoting the carbon number |
| CoStar: Inside and Out | ready with two layers (CoStar + Matterport) | Vexcel images, if we get access |
| LangChain: Best use of deepagents | ready | `ANTHROPIC_API_KEY` in `.env` on the demo laptop |
| Amazon: Best Practical AI Innovation | ready | the pitch |
| Peri: Forward Deployed | **not eligible yet** | one real interview, then fill `lightwell/consult.js` |
| Arlequin: AI-Driven Forensics | weak fit, honest entry possible | decide as a team whether to enter |

## Best Sustainability Hack

Asks for: technology that addresses an environmental challenge.

- Converting an empty office tower keeps its structure, so the carbon of a new building is not spent. Every tower
  shows **carbon avoided**, and the dashboard totals it.
- The number is an estimate: 500 kg CO2e per m2 for new construction, 60% of it avoided by reuse. Both are in
  *Assumptions* and can be changed live. Say so when you quote it.
- Homes downtown, on land that is already built on, next to jobs and transit.

## CoStar: Inside and Out (30% data, 30% agent, 25% usefulness, 15% demo)

| They ask for | What to show |
|---|---|
| At least two of the three layers, used together | **CoStar** records pick and qualify each tower (leasing, empty floors, tenants and lease ends, year, sprinklers, sales). **Matterport** scans measure the clear ceiling height inside it. The engine's height test then uses the scan, not the estimate. |
| Something from the combination | The agent's biggest open question is floor-to-floor height. On towers with a scan it answers that question itself and does not ask for a site visit. The **record cross-check** compares CoStar's records with the scan and the map and lists where they disagree. |
| Agentic, not a chat wrapper | Planner and six sub-agents, 24 tools. It ranks, tests a worse value for every weak input, asks you one question, replans, plans tenant moves, and a red team attacks the plan. |
| A real problem for a real person | Owners, brokers and the city: which tower can legally and physically become homes under Texas SB 840. |
| Spatial and visual | 3D map with scored towers, floor plates, home designer, Daylight X-ray, Photoreal 3D, Matterport tour, aerial flyover. |

Open: **Vexcel**. The importer (`real-data/parking.csv`) and the car counter (`backend/count_cars.py`) are built, but
the key is rejected by Vexcel's public API address. The hackathon address is in Vexcel's Python quickstart on the
CoStar Discord card. With it, parking counts turn the occupancy check into a real three-layer comparison.

## LangChain: Best use of deepagents

Asks for: a deepagent, any use case.

- `backend/agent.py` builds the run with `create_deep_agent`: a planner, six sub-agents (market, data scout,
  feasibility, policy, deals, red team) and 24 tools. *Ask Lightwell* is a second deepagent with the same tools.
- The badge under *Run agent* must read **Backend agent: claude-… via deepagents**. If it says scripted or offline,
  the key is missing: put `ANTHROPIC_API_KEY` in `.env` and restart the backend.
- Show the live steps, the team strip lighting up, the pause for a measurement, and the red team's verdict.

## Amazon: Best Practical AI Innovation (creativity, usefulness, technical, experience: 25% each)

| Focus area | What to show |
|---|---|
| Agentic behaviour | the multi-step run with a human question in the middle |
| Real-world impact | a ranked shortlist an owner could act on, with an owner memo |
| Adaptive intelligence | it replans from your answer or correction; it remembers your brief and corrections on the next visit and says so; the data scout learns missing occupancy from comparable towers |
| User-friendly design | plain-English request, example requests, source tag on every number, one click to the evidence |
| Creative innovation | cutting a lightwell through a deep floor; tenant moves to reach the 65% rule |

Must include: working prototype (yes), clear use case and target user (README, first lines), basic documentation
(README), presentation (see `DEMO_SCRIPT.md`).

## Peri: Forward Deployed

Eligibility needs three things in the submission: **the business name, the person's name and role, and one piece of
evidence** (screenshot, photo, short video or direct quote). `lightwell/consult.js` is still empty, so we are not
eligible until someone does the interview. `PERI_INTERVIEW.md` has the questions and where the answers go.

## Arlequin: AI-Driven Forensics

Asks for: AI that uncovers illegal or criminal patterns in forensic data (disk images, logs, emails), on public or
synthetic data, with evidence an investigator can check.

What we have is narrower and we should say so: a **record cross-check**. It finds places where independent records
about a building disagree (occupancy from two sources, a height record against a scan, storeys against height,
occupancy at the last sale against now), and shows both sources for each. Every line is an observation to
investigate, never an accusation.

- Their data rule is public or synthetic data only. Show it in **Demo fill-in** mode, where the checks run on
  OpenStreetMap (public) and simulated values. CoStar data is licensed, not public.
- It does not analyse disk images, logs or messages, and it does not claim to find crime. If the team enters this
  track, pitch it as evidence cross-checking for property records and let the judges decide.
