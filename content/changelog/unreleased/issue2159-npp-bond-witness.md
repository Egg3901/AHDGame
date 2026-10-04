---
date: 2026-10-02
title: Record landed NPP bond cash returns
summary: >-
  NPP investment accounts now record bond coupon and principal receipts in
  shadow accounting. Existing payments stay unchanged, and rejected writes
  do not create receipts.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [accounting, bonds, npp]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Publish coupon and principal witnesses only for landed NPP cash credits.
- Keep combined cash rounding and currency conversion unchanged.
- Batch publication and reuse receipt ids when publication is repeated.
