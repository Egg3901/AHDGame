---
date: 2026-10-07
title: Queued fund redemptions for NPPs pay out faster
summary: >-
  Queued index fund redemptions for NPPs are now paid together each turn, so
  far more of them are paid per turn and the waiting queue no longer grows.
tags: [turns, performance, index-funds, npps]
badges: [patch]
areas: [backend]
---

## What changed

- NPP redemptions waiting in an index fund's queue are now paid in groups rather than one at a time. Each one is still paid the same amount, in the same order, with its own record.
- Up to 2,000 queued redemptions can now be paid each turn, up from 250, so the backlog built up by NPP rebalancing clears instead of growing.
- If an NPP is removed while its payout is being made, its share goes back to the fund and stays owed, while the other payouts in the group go through.
