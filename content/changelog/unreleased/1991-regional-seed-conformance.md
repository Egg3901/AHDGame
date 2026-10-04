---
date: 2026-10-04
title: Fix 1991 regional seed consistency
summary: >-
  New 1991 worlds no longer retain obsolete regional statistics, and readiness
  checks cover the full Soviet region roster at the January opening.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [1991, world-setup]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Removed obsolete regional statistics from 1991 world setup while preserving national summaries.
- Corrected Soviet demographic and economic readiness checks to follow the January 1991 region roster.
