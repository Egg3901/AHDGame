---
date: 2026-10-04
title: Add deterministic bank viability calibration
summary: >-
  Add a reproducible offline model that applies current bank pricing, funding, finite sovereign pool supply, and the existing treasury claim guard to neutral and recession scenarios. The report records unpaid bill claims and makes no bank viability acceptance claim.
tags: [economy, banking, balance]
badges: [patch]
areas: [backend]
---

## What changed

- Add a deterministic viability model and calibration report using current loan, deposit, fee, insurance, and bond quote rules.
- Count bank coupon and maturity cash only when actual Treasury funding pays the claim; retain unpaid claims as non-cash obligations. Public-float coupon and fiscal-outflow limits remain explicit in the report.
