---
date: 2026-10-14
title: "NPP engine 6.12: weak parties run their best NPPs where they can win"
summary: At autonomy v6, a party whose regional organization is under 75% of the leading party's places its strongest NPPs in its most local races instead of its most senior ones.
tags: [npp, elections, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, generic primary fill (6.1 placement) reads the party's `statePartyOrg.organization` in the region against the leading party's.
- Below 75% of the leader's organization, the placement order reverses: the strongest NPPs go to the least senior races, where a regionally weak party can still win.
- Without organization data the 6.1 order is kept.
- The set of primaries filled is unchanged. The leading organization per region is computed once from the already-loaded context, with no new reads.
- NPP engine version 6.12.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
