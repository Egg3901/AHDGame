---
date: 2026-10-04
title: FX inflation pressure fades after exchange rates settle
summary: >-
  Exchange-rate movements create a finite inflation impulse. Holding a
  currency at its new exchange rate no longer adds permanent annual inflation.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, inflation, forex]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Measure exchange-rate movement over a rolling game quarter using settled history and the existing pressure cap.
- Return to zero FX pressure after rates settle, and avoid inferring an impulse from missing history or an initial seeded level.
