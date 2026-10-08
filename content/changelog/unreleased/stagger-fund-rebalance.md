---
date: 2026-10-08
title: Index funds rebalance across the day
summary: >-
  Each index fund now rebalances on its own turn of the day instead of every
  fund rebalancing on the same turn.
tags: [turns, performance, markets]
badges: [minor]
areas: [backend]
---

## What changed

- Every index fund used to rebalance its holdings on the same turn once a game day, and that turn ran close to a minute longer than the others. Each fund now rebalances on its own fixed turn of the day, so the work is spread evenly across the day's turns.
- Each fund still rebalances once a day. The market sees fund rebalancing trades spread through the day rather than arriving all at once.
