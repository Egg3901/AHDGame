---
date: 2026-10-04
title: Include upcoming bond repayments in corporate credit estimates
summary: >-
  Corporate credit estimates account for cumulative principal repayments in the
  next half game year, using available cash and estimated operating income.
tags: [economy, banking]
badges: [patch]
areas: [engine, frontend]
---

Upcoming corporate bond repayments now constrain the cash cushion component of
credit estimates. Covered repayments and distant maturities preserve the existing
score. Debt previews include the same forecast; default refinancing adds no cash
and still accounts for other upcoming bonds.
