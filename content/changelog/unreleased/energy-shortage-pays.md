---
date: 2026-10-09
title: Shortages pay producers more, and power plants need less machinery
summary: >-
  Goods in deep shortage now sell for up to twice their base price instead of
  one and a half times, power plants draw far less on scarce vehicles and
  machinery, and the margin breakdown names state enterprise efficiency,
  expropriation risk and economic model fit.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, balance, corporations, energy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine, fullstack]
---

## What changed

- A good in deep shortage now realizes up to 2x its base price, up from 1.5x. Producers of scarce goods earn more, and buyers of those goods pay more for them.
- Conventional power plants now use 0.03 of their output value in vehicles and machinery, down from 0.1, and 0.22 in steel, up from 0.15.
- The sector margin breakdown and the corporation page now show state enterprise efficiency, expropriation risk and economic model fit as their own lines instead of folding them into "Other factors".
- The corporation page now uses each country's investor confidence and state ownership level when it estimates those lines. Before, it treated both as missing.
