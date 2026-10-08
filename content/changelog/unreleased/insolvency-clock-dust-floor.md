---
date: 2026-10-08
title: Profitable corporations no longer flagged insolvent over pocket change
summary: >-
  A corporation that is earning money is no longer put on the insolvency clock
  because its cash dipped a trivial amount below zero.
tags: [corporations, economy]
badges: [patch]
areas: [backend]
---

## What changed

- A computer-run corporation that is making a profit is no longer marked as
  insolvent when its cash is below zero by less than one percent of a single
  turn of its earnings. Any marks already set for that reason clear on the next
  turn.
- Corporations that are losing money, or that are short by a meaningful amount,
  are treated exactly as before.
