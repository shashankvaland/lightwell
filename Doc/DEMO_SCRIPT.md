# Three-minute demo

Run it in **Real data only** mode with the Claude agent on. One person talks, one person clicks.

## Before the judges arrive

1. Backend running, and the badge under *Run agent* reads **Backend agent: claude-… via deepagents**.
2. Page reloaded (Cmd+Shift+R). If the **Brief** tab has a gold dot, open it and press **Forget**, unless you want to
   show the memory. If the Shortlist says *No tower passes this brief*, press the button it offers.
3. One full run done already, so the map tiles, the 3D city and the flyover are cached.
4. A screen recording of a full run ready, in case the Wi-Fi fails.

## The script

| Time | Do | Say |
|---|---|---|
| 0:00 | Start screen (*Why now?*) | "One in four office desks downtown Houston is empty, and the city needs homes. Since September 2025 Texas lets an office become homes without rezoning if 65% of it converts. The hard part is knowing which towers can." |
| 0:20 | Type or click an example request, press **Run agent** | "I ask in plain English. A planner agent built with deepagents turns that into a brief and hands work to six sub-agents." |
| 0:40 | Point at the team strip and the steps as they appear | "Market reads the real CoStar records: leasing, empty floors, tenants and lease ends. Matterport measures the ceilings in CoStar's 3D scans. Feasibility tests every floor for daylight and fire escape." |
| 1:05 | The **Matterport** step in the log | "Floor-to-floor height was the agent's biggest unknown. Here it did not ask me: the scan measured the ceiling, so it settled the question itself. That is CoStar's data and Matterport's data answering one question together." |
| 1:20 | The **Forensics** step, then click **RECORD CHECK** on a tower | "It also cross-checks the records. Where two sources disagree it shows both. These are things to investigate, not accusations." |
| 1:40 | If it pauses with a question, answer it or press *Skip* | "When a missing value would change its recommendation, it stops and asks for that one measurement, then re-ranks." |
| 1:55 | Top tower: card, **Photoreal 3D**, **Daylight**, **3D tour inside**, **Aerial flyover** | "The top pick: homes, cost per home, source tag on every number. Real sun and shadows, the inside of the building, the view from above." |
| 2:25 | **Plan tenant moves**, arcs on the map, red-team line | "It is not empty enough to reach 65% yet. So the agent plans which tenants move to which nearby towers, prices it, and a red-team agent attacks its own plan." |
| 2:45 | **Draft memo**, the carbon number | "It drafts the owner memo for me to approve. Reusing this tower avoids about this much carbon compared with building new: an estimate, with the assumptions on screen." |
| 2:55 | The checklist's first lines (after the Peri interview) | "And this is what a real broker told us they need before a site visit. It leads every checklist." |

## If a judge asks

- **"Is the data real?"** Real CoStar records on 15 towers, real Matterport measurements on the towers with office
  scans, real footprints for all of them. Anything else is tagged ESTIMATE, ASSUMED or MISSING on the card.
- **"Where is Vexcel?"** The importer and the car counter are built; say plainly whether the images are loaded.
- **"Is the fire result a code review?"** No. It is a preliminary screen and says so.
- **"Does the agent ever get it wrong?"** That is why every number has a source tag and the memo is only *reviewed*
  until someone changes an input.
