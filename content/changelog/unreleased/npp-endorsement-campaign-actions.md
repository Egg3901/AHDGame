---
date: 2026-09-15
title: Politician endorsements generate campaign actions again
summary: >-
  Endorsements from non-player politicians once again add to a campaign's
  action income each turn, matching the figure the campaign desk has been
  promising. Player endorsements are unchanged.
tags: [elections, campaigns, endorsements, actions]
badges: [minor]
areas: [engine]
---

## What changed

- Endorsements from non-player politicians count toward campaign action
  accrual again, in every race type. They had been informational only, so a
  campaign backed by them earned the baseline rate instead.
- The campaign desk's "per turn" figure already counted these endorsements, so
  campaigns holding them were shown an action income they never received. The
  displayed figure and the income now agree.

## Why

Returns are deliberately steep at first and shallow after that. Action income
is the baseline plus the square root of the endorsement count times three, so
the first endorsement is worth far more than the tenth, and stacking them has a
naturally falling payoff rather than a hard ceiling.

Only active, arranged endorsements count. Legacy organic endorsement records
stay hidden from the tally, exactly as they are on the campaign desk.
