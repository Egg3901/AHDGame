---
date: 2026-10-01
title: Organization cash accounting now includes dues, aid and fund spending
summary: >-
  Shadow cash accounting now tracks organization dues, tribute, aid and pooled
  fund spending against actual treasury and fund balances.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [accounting, international-organizations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Include native organization fund cash in accounting snapshots.
- Record successful treasury and fund movements without changing cash amounts.
- Distinguish tribute without a modeled treasury and preserve accounting batches when later work fails.
