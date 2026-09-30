---
date: 2026-09-30
title: Restore variation in background country estimates
summary: >-
  Background country estimates now use a properly mixed deterministic sampler,
  avoiding the population floor collapse caused by short country identifiers.
tags: [seed, background, economy]
badges: [patch]
areas: [backend, engine]
---

## What changed

- New worlds generate varied background populations and economic profiles using the existing coarse model.
- Population, sector capacity, domestic demand and held market contributions are rebuilt together.
- Background values remain labeled simulation estimates. Existing worlds require a new seed to receive the correction.
