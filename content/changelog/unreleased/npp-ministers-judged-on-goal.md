---
date: 2026-10-14
title: NPP heads judge ministers on their goals
summary: At autonomy v6, an NPP head of government judges a minister on the progress of the standing goals in their brief, keeping one who is turning a domain around and replacing one whose goal failed on their watch.
tags: [npp, autonomy, cabinet]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, when the government holds standing goals and a minister's brief covers one of them, the head judges that minister on the goal instead of on how far the domain sits below target:
  - a minister whose goal has gained at least 5 points of attainment since the attempt opened is kept, even when the domain is still far below target;
  - a minister who was in post when a goal on their brief failed, and whose new attempt shows no progress yet, can be replaced even when the shortfall is small;
  - a minister appointed after the failure is not blamed for it.
- Ministers with no goal on their brief, or whose goal is still being held without progress or failure, are judged on shortfall as before.
- Minimum tenure, the government and portfolio cooldowns, and the repeat-reshuffle cap still apply to every replacement.
- The replacement record names the reason as a failed goal when that decided it.

## Scope

Worlds below autonomy v6 are unchanged. NPP engine version 6.15.0, recorded in the [NPP changelog](/changelog/npp).
