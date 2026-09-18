---
date: 2026-09-18
title: Stabilize equity market valuation and liquidity
summary: >-
  Equity prices now recognize retained cash after primary share sales, while
  market liquidity and share settlement preserve finite cash and inventory.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, corporations, shares, liquidity]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Retained issuance cash is no longer deducted twice from tangible book value.
- Equity settlement allocates finite bids fairly and honors reserved shares.
- Market index snapshots exclude split and corporate-action noise.
