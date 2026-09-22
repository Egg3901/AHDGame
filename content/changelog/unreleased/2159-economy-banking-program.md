---
date: 2026-09-21
title: Economy and banking foundations
summary: >-
  Money transfers now recover more safely when a database operation fails, and
  the economy gains clearer market, index-fund, and corporation diagnostics.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, banking, index funds, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Added safer compensation for corporation, party, foreign-exchange, bond, and
  index-fund money flows on standalone databases.
- Added gated era-aware campaign pricing and a complete automated index-fund
  subscription and redemption cycle.
- Added admin diagnostics for market access and NPP-run corporation health.
