---
date: 2026-10-13
title: Sector input warnings name the bottleneck from the last production run
summary: >-
  Sector pages no longer pair an applied output throttle with a different
  world-market shortage when regional delivery or internal supply changes the
  tightest input.
tags: [interface, corporations]
badges: [minor]
areas: [frontend]
---

## What changed

- Sector input warnings use the bottleneck recorded for the last production run. The world-market projection remains separate, so local deliveries and internal supply no longer make the warning blame a different input.
