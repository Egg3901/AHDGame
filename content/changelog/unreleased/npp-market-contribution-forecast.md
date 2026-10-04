---
date: 2026-10-04
title: Align NPP mining forecasts with market realization
summary: >-
  NPP mining forecasts use the market's damped price realization, input availability
  and plants input bills. Lagged aggregate sellability helps estimate demand for a recipe.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, corporations, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Cap price incentives with the same square-root realization used by sector revenue.
- Estimate clearing sellability, respect throughput ramps and apply world-capped plants input prices.
- Preserve cooldowns, deposit guards, switch limits and legacy scoring when market realization is off.
