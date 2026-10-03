---
date: 2026-10-03
title: Large savings withdrawals explain the central bank's limit
summary: >-
  A savings withdrawal larger than the central bank can pay out now says how
  much it can pay right now, instead of failing with an internal error.
tags: [savings, central-banks, banking]
badges: [patch]
areas: [backend]
---

## What changed

- Savings held at the central bank are paid out of its household pool. A withdrawal larger than that pool now stops before anything moves and tells you the most it can pay right now, so you can withdraw that and the rest later. Before, it failed with an internal ledger message.
- Moving savings from the central bank to a private bank gets the same check.
