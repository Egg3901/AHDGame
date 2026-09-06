---
date: 2026-09-06
title: Crisis GDP rate shocks now survive the metric engine
summary: >-
Crisis GDP growth effects now enter the sector growth signal consumed by the
metric engine. The engine no longer overwrites those rate shocks while the
separate one-time physical GDP loss remains unchanged.
tags: [economy, crises]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

## Fixed

- Routed GDP growth effects from recurring crises and one-time interactions
  through `economic.sectorGrowth`, the metric engine's owned input channel.
- Kept crisis GDP rate decay, bounds, country scope, and one-time `gdpLoss`
  handling separate.
