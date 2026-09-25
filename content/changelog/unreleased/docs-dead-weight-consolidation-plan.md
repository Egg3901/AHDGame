---
date: 2026-09-25
title: Dead-weight plan execution and fund bid lookup
summary: >-
  Starts the audited performance plan by preserving an existing fund bid
  index after resets, aligning turn warning budgets with production telemetry,
  cleaning up corporation modules, and recording current timing evidence.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [planning, performance, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Adds `DEAD_WEIGHT_PLAN_AUDIT.md`, an audited execution plan that corrects
  the published dead-weight report's claims against the current `development`
  checkout, scopes fourteen work packages, and records the first production
  timing sample.
- Seeds the existing `shareOrders` fund bid index after world resets.
- Reconciles six turn round-trip warning budgets against recent production
  phase telemetry.
- Moves the two remaining corporation helpers into `src/lib/corporations/`.
