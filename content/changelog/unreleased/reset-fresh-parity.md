---
date: 2026-10-05
title: World resets now start exactly like a fresh world
summary: >-
  Resetting an existing world no longer carries leftovers from the old one
  into turn 1, so a reset world matches a brand-new 1991 seed.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [reset, economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Retail capacity can be built from the first turn of a reset world, and
  commodity prices start from the new world's price level.
- Regions, parties and voter groups for countries that are not part of the
  1991 map no longer survive a reset.
