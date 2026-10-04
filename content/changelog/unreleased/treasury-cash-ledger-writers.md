---
date: 2026-10-04
title: Route payments through funded Treasury cash
summary: >-
  Organization dues and aid, peace indemnities, and selected Treasury expenses
  now use funded government cash when enabled. Sovereign maturity payments
  freeze their holder and currency plan, retry from escrow, and retire the bond
  only after all funded payouts complete.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [accounting, bonds, governments]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Feature-gated Treasury cash routing covers organization dues, aid, tribute,
  organization funds, peace indemnities, selected budget spending, and crisis
  guarantee refunds. Cross-currency transfers use frozen settlement valuations.
- Due sovereign bonds keep one immutable due-turn holder quote. Guarded cash
  funding retries after shortfalls, bank epoch payouts keep a due-claim witness,
  payout resumes its exact receipt and uses the frozen native holder legs, and
  the bond retires only after cash and holder updates complete.
