---
date: 2026-10-04
title: Keep government event vote cards current
summary: >-
  Regional veto-override cards use the vote that enacted the bill. Court nomination
  cards load optional portraits in batches and publish only after a successful claim.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [government, discord, reliability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Forward the frozen override vote to the regional bill enactment card.
- Batch court nominee portrait lookups into at most two projected reads.
- Verify court outcomes, appointment tallies and duplicate-publication suppression.
