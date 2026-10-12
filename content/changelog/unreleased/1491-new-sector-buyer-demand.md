---
date: 2026-10-11
title: Keep buyer demand visible after a competitor founds a sector
summary: >-
  The Expand sector dialog no longer shows buyer demand as unavailable just
  because another company recently founded a sector making the same goods.
tags: [corporations, economy]
badges: [patch]
areas: [backend]
---

## What changed

- Count a newly founded sector with no plants as producing nothing yet, so measured buyer demand stays available until its first turn runs.
