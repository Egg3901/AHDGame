---
date: 2026-10-01
title: NPP sector founding cash now reconciles with accounting
summary: >-
  Accounting now records actual NPP sector founding expenses, including entry
  fees and starter builds, while preserving existing cash and capacity rules.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [accounting, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Witness successful NPP founding cash in plants and legacy modes.
- Use atomic cash stamps, one cohort read and idempotent ledger publication.
- Preserve landed witnesses through partial write failures without changing economic decisions.
