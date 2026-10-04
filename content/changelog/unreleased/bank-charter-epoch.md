---
date: 2026-10-04
title: Keep bank loans with their charter epoch
summary: >-
  Each bank services only loans from its current charter epoch. Resolved prior
  books keep amortizing, with recoveries credited to deposit insurance.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [banking, charter, loans]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Rechartering starts with an empty loan book for the new epoch. Existing loans
  retain their originating charter. Failed estates must resolve before
  rechartering; resolved recoveries go to deposit insurance.
- Legacy loan records receive charter epoch metadata through an idempotent
  migration and remain readable while the backfill is pending.
