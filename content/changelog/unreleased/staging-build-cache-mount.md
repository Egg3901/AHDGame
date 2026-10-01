---
date: 2026-09-25
title: Repair Railway build cache sweep
summary: >-
  Railway builds now clear stale cache contents without removing the mounted
  cache directory, allowing staging releases to build again.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [deployment, railway]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Cleared build cache contents while preserving Railway's cache mount point.
- Kept cache cleanup failures from blocking a deployment.
