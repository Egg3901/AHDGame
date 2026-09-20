---
date: 2026-09-20
title: NPP founding sweep batches already-CEO check and blocked-set load
summary: >-
  The hourly turn's NPP corporation-founding sweep now checks the whole
  candidate pool for existing CEOs in one query instead of one per candidate,
  and reuses its command-economy lookup instead of reloading it per attempt.
  Same foundings, less database chatter.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [turn performance, npps, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- `foundNppCorporationsSurplus` batches the already-CEO exclusion into one
  `$in` query and passes its blocked set into `nppFoundCorporation`, cutting
  the sweep from ~186 to ~49 reads at 46 founding attempts per cycle with
  identical outcomes (same RNG stream, same eligibility, same results).
