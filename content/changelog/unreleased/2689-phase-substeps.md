---
date: 2026-09-30
title: Finer turn timing for the slowest turn phases
summary: >-
  Turn logs now record where time goes inside the heaviest phases, so slow turns can be fixed from real evidence.
tags: [performance, tooling]
badges: [patch]
areas: [backend]
---

## What changed

- Corporation, bond, index fund, NPP, union and history phases record timing and database calls for each of their internal steps.
- Phases that make many database calls record which data they read most, so repeated lookups are visible without a special profiling run.
