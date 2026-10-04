---
date: 2026-10-04
title: Reconcile construction in progress from build orders
summary: >-
  Construction in progress now follows the remaining build orders, preventing
  stale or negative values from distorting sector book value and exit floors.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The turn processor is the sole writer of stored construction in progress and
  recalculates it from the remaining queue, clamped at zero. Build, delivery,
  cancellation, transfer, and NPP order handling update queue state only.
- Valuation and detail consumers use the queue already loaded by their query
  when calculating current construction in progress.
- A queue change concurrent with a turn snapshot can leave the stored snapshot
  briefly behind until the next turn reconciliation.
