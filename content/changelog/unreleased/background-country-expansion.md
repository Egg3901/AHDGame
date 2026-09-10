---
date: 2026-09-10
title: Simulate every sovereign country in the background
summary: >-
  Every era-valid sovereign country now participates in the world economy,
  using a lightweight background simulation where full domestic data is not available.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, world-seeds, performance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Added an era-aware background-country tier covering sovereign states in every supported preset.
- Kept dependencies, emergent states, and dissolved countries out of economic simulation until their lifecycle allows it.
- Batched staggered macro updates and excluded background countries from NPP sphere processing.
- Cleared stale macro state between preset resets and added indexes for the new turn queries.
