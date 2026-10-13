---
date: 2026-10-13
title: "NPP engine 6.7: NPP governments whip their own goal bills"
summary: At autonomy v6, an NPP-led government puts a soft whip on its own members for the NPP bills it sponsored in a standing-goal domain, never where a whip already exists or a player leads the party.
tags: [npp, legislation, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, during autonomous NPP bill voting, a soft "for" whip replaces the default party-line lean when all of these hold:
  - the government is formed and NPP-led (a PM or president NPP, no player PM);
  - the governing party has no player chair or vice-chair;
  - the voter is an NPP of the governing party;
  - the bill is NPP-sponsored by that party;
  - the bill's policy domain carries an active standing goal.
- The whip goes through the normal `computeWhipForce` (soft base 30, scaled by loyalty and stubbornness). An explicit persisted whip always takes precedence.
- The whip is computed in memory. No whip documents are written, so whip and defiance surfaces are unaffected.
- NPP engine version 6.7.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
