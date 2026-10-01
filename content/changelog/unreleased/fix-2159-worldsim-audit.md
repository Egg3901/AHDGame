---
date: 2026-09-21
title: Long worldsim experiment reports
summary: >-
  Long-running world simulations now retain their full experiment timelines
  instead of losing the report when its history outgrows one database document.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [worldsim, telemetry]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Stores long-horizon seat, party organization, and corporation histories in
  bounded chunks while keeping existing reports readable.
