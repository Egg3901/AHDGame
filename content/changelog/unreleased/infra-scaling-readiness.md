---
date: 2026-09-25
title: Dedicated turn worker for steadier game turns
summary: >-
  Turn scheduling can continue through website deployments once the separate
  turn worker is enabled.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [turns, reliability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Added a dedicated turn worker option so website deployments can leave an active game turn running.
