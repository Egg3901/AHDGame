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
  desk and the turn that pays it now work from one shared rule, so the figure a
  campaign is shown is the figure it earns. That also closes three quieter
  mismatches the old desk carried: it counted player endorsements in races that
  do not grant actions for them, ignored governor and executive endorsements
  entirely, and used a full baseline for campaigns an unaligned politician runs.

## Why

Returns are deliberately steep at first and shallow after that. Action income
is the baseline plus the square root of the endorsement count times three, so
the first endorsement is worth far more than the tenth, and stacking them has a
naturally falling payoff rather than a hard ceiling.

Only active, arranged endorsements count. Legacy organic endorsement records
stay hidden from the tally, exactly as they are on the campaign desk.
