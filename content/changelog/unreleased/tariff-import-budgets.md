---
date: 2026-10-04
title: Tariffs reduce feasible import volumes
summary: >-
  Import tariffs now constrain trade quantities even when only one foreign
  supplier is available. Corporate reachable markets use the same constraint.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, trade, tariffs, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Clearing uses a fixed import budget in untaxed commodity-unit equivalents.
  A tariff consumes more of that allowance per imported unit, while affinity
  still determines partner preference. This is an authored spending assumption.
- Available supply, embargo caps and free-trade exemptions remain binding.
  Unmet import requests remain visible in the clearing residuals.
- Commodity snapshots and era-world corporate order books use the same rule.
- A deterministic sensitivity report covers tariffs from zero to 100 percent
  and different supplier capacities. World balance qualification remains pending.
