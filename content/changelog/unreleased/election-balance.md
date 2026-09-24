---
date: 2026-09-24
title: Make UK election baselines and seat thresholds fairer
summary: >-
  UK elections now use each party's current regional registration instead of
  its starting-era share, and the Commons party threshold is now 10%, removing
  unintended advantages and harsh zero-seat cliffs in crowded regional races.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, balance, uk]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Changed the UK structural registration baseline to follow current regional
  Reg for every party.
- Kept non-UK elections unchanged and added safe fallbacks for old worlds with
  no current UK registration data.
- Lowered the party-pooled UK Commons and snap-election seat threshold from 20%
  to 10%; the US House remains at 20%.
- Updated election documentation and added a live-snapshot simulation report
  covering both changes.
