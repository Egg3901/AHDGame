---
date: 2026-09-06
title: Editing a starting army no longer re-prices every army already in the field
summary: >-
  What a country's forces cost to run is measured against the army it started
  with. That comparison was recalculated from the current rulebook every time it
  was asked, so changing any starting army quietly changed the running costs of
  every army in a world already underway. A world now remembers its own starting
  figures.
tags: [military, budget, seeds]
badges: [patch]
areas: [engine]
---

## What changed

- A world records its own starting force costs when it is created, and its
  defence budgets are measured against those, not against whatever the rulebook
  says later.
- Worlds created before this keep working exactly as they did.
- The figures are rewritten every time a world is created, so a new world never
  inherits the old one's.

## Why it matters

Upkeep is charged as a share of what your forces cost against what your country's
starting forces cost. Because that second number was recalculated on demand,
correcting a country's historical starting army would have changed the running
costs of every army already in the field, in a world nobody had touched. In one
case a nation's forces would have become nearly free, and in two others they
would have gone into immediate arrears on rosters those players never chose.

Nothing about the current world changes.
