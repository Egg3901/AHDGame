---
date: 2026-09-06
title: Turns decode 60% less data and make far fewer database calls
summary: >-
  The hourly turn reads 60% less data from the database and issues far fewer
  queries, so turns finish sooner on the server and much sooner in
  singleplayer. New guards keep future phases from undoing it.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [performance, engine, singleplayer]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Turn phases no longer load every NPP's full legislative stance map (30 KB per
  NPP) unless they are voting on a bill, and then only for the officials who
  vote and the laws on the floor.
- Sector reads in the corporation, union, market and share-price phases skip
  build queues and plant accounts they never use.
- The state-owned enterprise mandate pass, the share-order fill loop and the
  fund bond reserve batch their database work instead of issuing one query per
  row.
- Measured on a seeded 1953 world: 436 MB to 168 MB of data decoded per turn,
  11,250 to 9,500 database round trips, and a singleplayer turn from 30s to
  23s.
- Every phase now has a round-trip budget checked on every turn, and a build
  check refuses unprojected reads of the heavy collections on the turn path. 
