---
date: 2026-10-04
title: Nigeria leadership results survive retries
summary: >-
  Nigeria's chamber leadership results keep the selected winner when election
  resolution is retried. Concurrent resolutions cannot seat one candidate
  while announcing another.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [government, elections, reliability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Persist the selected result before applying nomination and office updates.
- Resume incomplete results with the same winner and publish after completion.
- Block a new election until the previous result is complete.
