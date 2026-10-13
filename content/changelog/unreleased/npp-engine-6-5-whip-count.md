---
date: 2026-10-13
title: "NPP engine 6.5: NPP sponsors count the votes first"
summary: At autonomy v6, an NPP sponsor projects the lower-chamber vote with the no-whip voting forces and sets aside a bill that is short, trying up to three bills before filing nothing.
tags: [npp, legislation, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, before introducing a national bill, the NPP sponsor projects the vote in the lower chamber.
  - For NPP members, the projection uses the forces autonomous bill voting applies with no whip: `computeCrossPressureForces` (ideology, district, donors), the co-partisan party-line lean, and the v1 opposition bloc.
  - Player seats are the live chamber tally minus NPP seats, counted for when they share the sponsor's party and against otherwise.
- A bill projecting no more seats for than against is set aside, and the next-best legislation type is tried, up to three. If none passes the count, the sponsor files nothing and keeps its cap slot and cooldown. Tax-slider bills are filed without a count, because their rate is resolved at propose time.
- The governing and opposition passes both count. No new database reads: the chamber tally already loaded for government directives supplies the seats.
- NPP engine version 6.5.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
