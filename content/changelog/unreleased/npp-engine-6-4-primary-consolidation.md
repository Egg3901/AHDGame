---
date: 2026-10-13
title: "NPP engine 6.4: trailing NPPs leave late primaries"
summary: At autonomy v6, a clearly trailing non-incumbent NPP withdraws from an NPP-only primary in its last 12 turns, without endorsing, and no new NPP challenger enters in that window.
tags: [npp, elections, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, in the last 12 turns before a primary closes, a non-incumbent NPP whose strength (political influence plus favorability) is under 60% of its party's strongest candidate in that primary withdraws.
- Withdrawal uses the same cleanup as slate withdrawals (candidacy withdrawn, tally scrubbed, campaign archived) and sets an election cooldown so the NPP cannot re-file in that primary.
- No endorsement is made. NPP endorsements remain player-requested only (owner decision 2026-10-13).
- A primary with any player candidate is never consolidated.
- At v6, the NPP challenger pass skips primaries inside the same 12-turn window.
- NPP engine version 6.4.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
