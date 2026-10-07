---
date: 2026-10-07
title: Index fund turns no longer stall on long redemption queues
summary: >-
  When many index fund redemptions were waiting at once, the turn tried to pay
  a slice to every one of them every turn and could run out of time. Each turn
  now pays a bounded batch, and whoever was skipped goes first next turn.
tags: [index-funds, turns, economy]
badges: [patch]
areas: [backend]
---

## What changed

- Queued index fund redemptions are now paid in rotating batches each turn instead of all at once. Redemptions skipped in one turn are first in line the next turn, and the cash they did not draw stays in the fund for them.
- The share each redemption receives is unchanged: it is still measured against everything waiting in the queue, so no holder can take a larger share by being early.
- When more funds have waiting redemptions than a turn can serve, the order in which funds are served rotates every turn, so every fund's queue is paid within a few turns.
