---
date: 2026-10-01
title: Faster index fund rebalance sales
summary: >-
  Index fund rebalance sales read each market pool once and record their
  ledger entries together, so the daily rebalance turn takes less time.
tags: [performance, turns, index-funds]
badges: [patch]
areas: [backend]
---

## What changed

- A rebalance sale prices against and settles with a single read of its market pool instead of four.
- Ledger entries for the day's rebalance sales are written together after the sales, matching how rebalance purchases already work.
- Sale prices, fills and fund balances are unchanged.
