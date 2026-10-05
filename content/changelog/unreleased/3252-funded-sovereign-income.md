---
date: 2026-10-05
title: Record funded sovereign earnings for banks
summary: >-
  Paid sovereign coupons and known-basis Treasury gains now appear in bank
  earnings, with principal excluded and settlement retries kept idempotent.
tags: [banking, treasury]
badges: [patch]
areas: [backend, frontend, engine]
---

## What changed

- Paid sovereign coupons are included in the matching charter's realized
  banking income and shown in the bank console.
- Funded Treasury sales and sovereign maturities recognize only the difference
  between proceeds and a frozen, known purchase basis. Unknown basis remains
  unclassified; returned principal is not earnings.
- Receipt replay and the BankingTurn publication compare-and-set preserve the
  original income turn and cannot overwrite concurrent payout lines.
