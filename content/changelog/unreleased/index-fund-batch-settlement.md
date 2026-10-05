---
date: 2026-10-05
title: Index fund rebalance buys settle as one recoverable batch
---

When an index fund rebalances, its public float purchases now settle together as a single recoverable batch instead of one settlement per trade. Fills, prices, fees and rounding are unchanged, an interrupted batch resumes without posting anything twice, and a batch that loses a race with a concurrent trade falls back to the one-at-a-time path. Rebalance turns make far fewer database calls.
