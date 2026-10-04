---
date: 2026-10-04
title: Evidence-based bank insurance premiums
summary: >-
  Bank insurance premiums can use measured net claims and insured-deposit
  exposure to price a risk-weighted rate and refill a stated reserve target.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [banking, insurance, economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Premiums remain at the existing 0.4% provisional annual rate until the fund
  has ten years of measured exposure and at least three paid claims. After
  that, the rate reflects same-cohort net claims and refills a one-year claim
  reserve over five years, while preserving the bank's existing reserve-ratio
  risk weight.
- The accompanying 1991 calibration records current funded-cash and bond-pool
  constraints. Its neutral and aggressive cases still fail before acceptance;
  the report does not claim bank viability.
