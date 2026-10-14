---
date: 2026-10-14
title: "NPP engine 6.14.1: v6 is the default for new local worlds"
summary: New singleplayer and simulation worlds default to autonomy v6; existing worlds and the live multiplayer world keep their level.
tags: [npp, singleplayer, worldsim, autonomy]
badges: [patch]
areas: [backend, engine]
---

## What changed

- The singleplayer `new-game` and `setup` routes default an omitted autonomy level to `v6` (was `v4`). The singleplayer home and admin screens offer V6, and the home screen starts on it.
- `scripts/sim/runWorld.ts` defaults `--autonomy` to `v6` (was `v3`). A/B comparisons must name both levels.
- Hosted fresh-world flag defaults and running worlds are unchanged.
- The desktop client lists and recommends V6, and its statistics allowlist accepts it (AHDClient, separate PR).
- No NPP decision changes. NPP engine version 6.14.1, recorded in the [NPP changelog](/changelog/npp).
