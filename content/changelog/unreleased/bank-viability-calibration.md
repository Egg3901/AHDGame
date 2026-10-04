---
date: 2026-10-04
title: Add deterministic bank viability calibration
summary: >-
  Add a reproducible offline model that applies current bank pricing and funding rules to neutral and recession scenarios. The report records current profitability gaps and excludes unverified treasury bill income.
tags: [economy, banking, balance]
badges: [patch]
areas: [backend]
---

## What changed

- Add a deterministic viability model and calibration report using current loan, deposit, fee, insurance, and bond quote rules.
- Keep bill holdings and coupon income at zero until eligible public inventory and funded pool depth are verified.
