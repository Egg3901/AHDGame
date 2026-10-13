---
date: 2026-10-13
title: "NPP engine 6.1: parties run their strongest NPPs for the senior races"
summary: At autonomy v6, a party filling open primaries with NPPs places its strongest available NPPs in the most senior offices, and its nationwide executive slot goes to its strongest NPP.
tags: [npp, elections, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, generic NPP primary fill keeps the same set of primaries it fills, but assigns the strongest available NPPs (political influence plus favorability) to the most senior of them. Below v6, NPPs are taken in load order and the lowest office (state senate) is filled first.
- At v6, a party's nationwide executive primary slot goes to its strongest available NPP rather than the lowest id.
- The NPP election context now loads political influence and favorability.
- NPP engine version 6.1.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
