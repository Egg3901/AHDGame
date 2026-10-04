---
date: 2026-10-04
title: Modern Turkey regional population weights
summary: >-
  Modern Turkey worlds use dated 2023 regional population weights, scaled to
  the existing national population total. Region seeders and geography lookups
  now select the same bundle.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [population, elections, seeds]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Route 2019, 2023 and 2027 regional populations and assembly seats through one modern bundle.
- Keep observed population counts separate from the game's fixed population and GDP totals.
- Preserve historical seed rows and the existing 1999 and 2007 population proxy.
