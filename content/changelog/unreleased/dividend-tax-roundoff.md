---
date: 2026-10-16
title: Keep dividend rounding from stopping income-tax settlement
summary: >-
  Dividend tax receipts preserve credited proceeds when independently accumulated
  totals differ by floating-point roundoff, allowing income-tax settlement to finish.
tags: [dividends, taxation]
badges: [hotfix]
areas: [engine]
---

- Bound dividend income and capital allocations to the amount actually credited.
- Read existing roundoff-only dividend remainders without changing tax rates or wallet credits.
- Keep malformed receipts and material overallocations fail-closed.
