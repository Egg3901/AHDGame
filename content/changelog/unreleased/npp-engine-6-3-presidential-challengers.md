---
date: 2026-10-13
title: "NPP engine 6.3: presidential primary challengers in countries without players"
summary: At autonomy v6, presidential primaries in countries with no players can draw a same-party NPP challenger, picked from the party's five strongest available NPPs nationwide.
tags: [npp, elections, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, the NPP primary challenger pass also covers presidential primaries in countries that are not enabled for players. Below v6, and in every country with players, presidential primaries stay excluded as before.
- A presidential challenger is drawn from the party's NPPs across the whole country instead of the primary's state, limited to the five strongest available (political influence plus favorability), then weighted by office-seeking as in other primaries.
- The challenge probability (15% base times office-seeking) and the per-country limit of two challengers per pass are unchanged.
- NPP engine version 6.3.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
