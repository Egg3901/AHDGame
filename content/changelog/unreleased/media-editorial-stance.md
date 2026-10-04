---
date: 2026-10-04
title: Add gated media editorial audience effects
summary: >-
  Media CEOs can publish a public editorial stance when the world rule is
  enabled. Audience mismatch reduces advertising fill, while local outlet
  share bounds the favorability nudge for aligned active candidates.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [media, economy, elections]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack, engine]
---

## What changed

- Added a default-off editorial stance setting for media corporations.
- Mismatched outlets have lower available advertising fill, and aligned active candidates receive a bounded favorability nudge based on delivered local audience share.
