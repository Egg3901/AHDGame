---
date: 2026-10-04
title: Modern Turkey population and metric profiles
summary: >-
  Modern Turkey worlds use dated population weights, census proxies and a
  complete modern metric profile. Seed writers, geography lookups and metric
  decay targets now select the same modern bundles.
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
- Use documented national age, education, urbanity and ethnic survey proxies for modern demographics; retain income and political positions as explicit game assumptions.
- Replace inherited historical metric values and decay targets with a complete modern profile, distinguishing sourced national observations from gameplay assumptions.
