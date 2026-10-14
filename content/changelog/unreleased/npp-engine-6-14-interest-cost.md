---
date: 2026-10-14
title: "NPP engine 6.14: voters mark down NPP votes their holdings decided"
summary: At autonomy v6, an NPP whose own business interest decided its vote loses 1 favorability, once per voting pass, floored at zero.
tags: [npp, legislation, corporations, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, autonomous bill voting compares each NPP's verdict with and without its 6.8 business-interest force.
- When the interest changed the verdict, the NPP loses `INTEREST_VOTE_FAVORABILITY_COST` (1) favorability, at most once per voting pass and never below zero.
- One batched `npps` write per pass.
- NPP engine version 6.14.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
