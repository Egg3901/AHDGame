---
date: 2026-10-04
title: Harden market and share history views
summary: >-
  Share history stays readable when older trades have no anchor amount, and
  market charts render theme colors consistently.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, markets]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Older share-history rows without anchor values now show an unavailable value
  instead of breaking the panel. Market charts resolve theme colors to values
  supported by the chart renderer.
