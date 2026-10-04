---
date: 2026-10-04
title: Correct opening bond inventory in bank calibration
summary: >-
  The bank calibration model now includes the 1991 seed's sovereign bond
  maturities and finite pool funding, so coupon availability follows the
  seeded market inventory.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- The deterministic bank viability report now accounts for opening sovereign
  bond tranches, funded auction capacity, and separate zero-cash versus seeded
  pool cases.
- The updated results report first-turn coupon arrears, neutral ROE sensitivities,
  and the remaining Treasury cash-conservation limits.
