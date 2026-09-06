---
date: 2026-09-06
title: Regional budgets alternate turns and the turn profile ranks phases by time
summary: >-
  The five regional budget phases now run on alternate turns with their drift
  scaled to match, trimming every turn's database load, and the turn profiler
  reports which phases take the time.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [performance, engine, budgets]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Regional budgets (UK, Japan, the Laender countries, the one-party countries,
  Russia) recompute every other turn instead of every turn. Nothing in them
  accrues per turn, and the UK value-base drift is scaled to two turns, so
  regions end up in the same place one turn later. Turn logs mark the
  off-turn phases as skipped rather than absent.
- The per-sector state-metric margin modifier is memoized within a turn.
- Under the turn profiler, the slowest phases are printed with their wall
  clock and round trips, which singleplayer had no other way to see.
