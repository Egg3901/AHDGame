---
date: 2026-09-10
title: Current account state gates optional API personalization
summary: >-
  Public election, auction, corporation, bond, suggestion and government views
  now resolve optional player details from the current account record.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: []
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Public views continue to work for signed-out players, while revoked or banned
  accounts no longer receive stale personalized details. Temporary account
  service failures return a safe server error instead of silently treating the
  request as anonymous. These responses are explicitly non-cacheable.
