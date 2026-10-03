---
date: 2026-10-03
title: Simulation accounting checks include the first turn
summary: World simulations capture actual opening cash before advancing and preserve prior snapshots when resumed.
tags: [accounting, simulations]
badges: [patch]
areas: [backend]
---

## What changed

- Capture opening balances after world setup so the first turn can check cash conservation.
- Keep recorded balances when resuming, so unexplained cash changes remain visible.
- Stop before advancing if the opening snapshot cannot be saved or is invalid.
