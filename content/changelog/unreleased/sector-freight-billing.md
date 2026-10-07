---
date: 2026-10-07
title: Freight bills follow each sector’s share of state demand
summary: >-
  Corporate sectors now pay freight in proportion to their share of all state
  demand. Small sectors no longer inherit shipping costs belonging to other buyers.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, logistics, freight]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [hotfix]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Freight charges include household and unowned demand in the allocation denominator.
- Hauling income follows the corporate share of the full state freight network.
- Shipping bills use demand and supply from the same sourcing turn.
