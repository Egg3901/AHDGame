---
date: 2026-10-07
title: Preserve balance snapshot identity on replay
summary: >-
  Replaying a turn now updates its balance snapshot and pre-Forex checkpoint
  without changing the stored document identity or failing MongoDB's immutable
  _id check.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [ledger, replay]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Replaced per-turn snapshots and checkpoints with updates that assign `_id`
  only when the document is first inserted.
- Added regression coverage for replaying both snapshot types against MongoDB's
  immutable `_id` behavior.
