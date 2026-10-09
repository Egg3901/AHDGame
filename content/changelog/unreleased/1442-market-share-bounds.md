---
date: 2026-10-09
title: Market share on the sector page can no longer pass 100%
summary: >-
  Your share and rival shares in a sector's market are now capped at 100% and
  measured against the exact market total. Hover Total market and Your share
  for what each figure counts.
tags: [corporations, market-share]
badges: [patch]
areas: [fullstack]
---

## What changed

- Sector market shares are measured against the unrounded market total and never go above 100%.
- Loss-making rows no longer shrink the market total below a producer's own revenue.
- The Total market and Your share labels explain what they measure.
