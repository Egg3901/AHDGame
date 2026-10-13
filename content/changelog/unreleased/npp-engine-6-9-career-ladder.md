---
date: 2026-10-13
title: "NPP engine 6.9: ambitious NPP incumbents run for higher office"
summary: At autonomy v6, a single-seat NPP incumbent with ambition 70+ and strength 100+ files for an open, more senior race in its home region instead of defending its seat.
tags: [npp, elections, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, before an NPP incumbent defends its seat, the incumbent pass checks for a career step. It takes one when all of these hold:
  - the incumbent has ambition of at least 70 and political influence plus favorability of at least 100;
  - it holds a single seat (`seatsHeld` at most 1);
  - it is not held by a chair's slate assignment;
  - an open primary exists in its home region for a more senior office (higher race-priority index), meaning no active candidate and no defending incumbent from its party.
- When it applies, the NPP files there instead of defending, choosing the most senior option. Its seat is filled by ordinary generic fill.
- Nationwide executive races are excluded from the ladder.
- NPP engine version 6.9.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
