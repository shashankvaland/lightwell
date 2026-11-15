# Peri interview: what to ask and where the answers go

The Peri track needs a real business we consulted during the hackathon: its name, the person's name and role, and one
piece of evidence. This cannot be made up. One 10 to 15 minute conversation is enough.

## Who to talk to

Anyone who decides which building to look at, or who would live with the result:

- a leasing broker or a commercial property manager
- a landlord or a small developer
- a real-estate or proptech startup
- a student organisation that deals with housing also qualifies

It does not have to be in Houston. The workflow (what do you check before a site visit?) is the same anywhere.

## Before you start

Ask: **"May we use your name, your business's name and one quote in our hackathon submission and in the project's
public code?"** `lightwell/consult.js` is in a public repository and the quote appears in the memo. If they prefer not
to be named in the code, keep the name for the Devpost form only and write "a leasing broker" in `consult.js`.

## Questions (about 10 minutes)

1. How do you decide which building is worth a visit today? What do you open first?
2. What do you need to know before you walk in, and where does that information come from?
3. Which numbers do you not trust, and how do you check them?
4. What has gone wrong before because something was missing or wrong?
5. Show them Lightwell on one tower. What is confusing? What is missing?
6. If this were switched on Monday, what is the first thing you would use it for?

Write down their exact words for one sentence. That is the quote.

## Evidence (one is enough)

A photo of the conversation, a screenshot of the call or the chat, a short video, or the direct quote. Keep the
original for the Devpost form.

## Put the answers in `lightwell/consult.js`

```js
window.LIGHTWELL_CONSULT = {
  business: "…",          // the business
  person: "…",            // the person consulted
  role: "…",              // their role
  date: "2026-11-15",
  quote: "…",             // one direct quote
  items: [
    { text: "What they need to see before a site visit, in their words", when: "" },
    { text: "Something that only matters for towers with a lightwell", when: "lightwell" },
    { text: "Something that only matters when occupancy looks wrong", when: "flag" },
  ],
};
```

Their items then appear **first** in every tower's *Before a site visit* checklist and in every memo, with their name.
Reload the page to see them.

If they ask for something small that the app does not do yet, build it and show it to them again. Peri scores whether
the business could adopt it right away.

## On Devpost

Business name, the person's name and role, and the evidence.
