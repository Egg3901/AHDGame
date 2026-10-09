---
date: 2026-10-08
title: Index fund market quotes refresh in fewer steps
summary: >-
  Index funds now refresh their standing buy and sell quotes on the stock
  market each turn in a handful of steps per fund instead of one step per order.
tags: [turns, performance, markets]
badges: [patch]
areas: [backend]
---

## What changed

- Every turn, index funds withdraw their standing buy and sell quotes on the stock market and post fresh ones. They now do this together for each fund rather than one order at a time, so the index fund step of each turn makes about a quarter as many database calls. The same quotes are posted at the same prices, and funds end with the same cash as before.
