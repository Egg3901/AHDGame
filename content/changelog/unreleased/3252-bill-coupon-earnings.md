---
date: 2026-10-05
title: Funded bill coupons now count as bank earnings
summary: >-
  Sovereign coupons paid in cash to a bank now appear in its realized income,
  console earnings table and valuation.
tags: [banking, treasury]
badges: [patch]
areas: [backend, frontend]
---

## What changed

- A funded coupon raises the bank's realized income in the same atomic write that
  credits its vault, so a crash or retry can never split the two.
- The bank console shows a Treasury bill coupons line, included in the bottom line.
- Maturity principal stays a balance-sheet transfer and never counts as income.
  Coupons for a replaced or failed charter go to deposit insurance, not the new bank.
