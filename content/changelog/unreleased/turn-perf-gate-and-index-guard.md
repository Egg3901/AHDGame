---
date: 2026-10-05
title: Turn performance qualification gate and seed index guard
summary: >-
  Turn performance changes now have a repeatable aged-world benchmark gate,
  and every database index a new world creates is checked for a path onto
  running worlds.
tags: [performance, tooling]
badges: [patch]
areas: [backend]
---

## What changed

- The aged-world turn benchmark reports quiet, NPP action, fund rebalance and election deadline turns separately, runs with a fixed random seed, and compares against a saved baseline, failing on round-trip or wall-time regressions.
- A guard test fails when a new seed index has no route onto a running world, and the index drift report can now fail a check when reconcilable indexes are missing.
