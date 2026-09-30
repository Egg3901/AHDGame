---
date: 2026-09-30
title: Faster turn processing for long-running worlds
summary: >-
  Turn history recording no longer slows down as a world ages.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Worlds created before long-horizon telemetry now get the indexes their per-turn history writes need, so recording no longer scans every stored point each turn.
