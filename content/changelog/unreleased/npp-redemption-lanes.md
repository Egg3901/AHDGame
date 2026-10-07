---
date: 2026-10-07
title: Faster NPP fund rebalancing
summary: >-
  The periodic pass where NPPs rebalance their index-fund holdings now handles
  different NPPs side by side. The same redemptions are queued, much faster.
tags: [turns, performance, index-funds, npp]
badges: [patch]
areas: [backend]
---

## What changed

- NPP fund rebalancing works on several NPPs at once instead of one after another. Each NPP's own steps still happen in order, and the redemptions, units and amounts are exactly the same.
