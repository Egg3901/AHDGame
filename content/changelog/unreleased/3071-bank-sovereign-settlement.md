---
date: 2026-10-04
title: Settle bank-held sovereign coupon and maturity claims from funded cash
summary: >-
  Bank-held sovereign coupon and maturity payments now use guarded, replayable
  cash transfers from the treasury and target the matching charter epoch.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, banking]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- TreasuryTurn freezes coupon claims from the opening bond snapshot and
  reconciles their funded payment against cash debt service without changing
  gross budget interest reporting.
- Sovereign maturity settlement separates bank principal from the existing
  non-bank cash debit. Unfunded bank claims remain outstanding, and claims for
  a closed or rechartered bank epoch go to the currency insurance fund.
- Acquisitions and takeovers wait until funded sovereign claims are settled so
  an absorbed corporation cannot delete their escrow.
