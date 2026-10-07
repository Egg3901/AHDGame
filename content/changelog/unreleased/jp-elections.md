---
date: 2026-10-07
title: Fix JP Shugiin proportional seat allocation
summary: >-
  Japanese House of Representatives races now award every regional seat
  proportionally. Parties need at least 10% of the vote to qualify, and
  existing 1991 races are corrected automatically.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, japan, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Filled the complete regional seat allocation instead of limiting each player candidate to one seat.
- Applied the 10% party threshold to regular, snap and mixed-system regional list counts.
