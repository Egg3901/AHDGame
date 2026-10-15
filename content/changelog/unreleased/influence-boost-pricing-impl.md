---
date: 2026-10-15
title: Price player boosts against full self-action equivalents
summary: >-
  Player-funded boosts are priced from the target's stats and home economy at
  1.25 times the equivalent self-action cost, while attacks use 1.50.
  The interaction panel shows the current action and fund costs before players commit.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [influence, action-costs]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, frontend]
---

## What changed

- Barnstorm and support use a 1.25 multiplier; attacks use 1.50. Each uses the
  target's stat-dependent, region-specific self-action quotes, scaled to the
  full effect.
- The interaction panel displays the current action and campaign-fund costs.
