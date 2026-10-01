---
date: 2026-10-01
title: Faster index fund bond purchases
summary: >-
  Index funds now settle each turn's bond purchases together instead of one
  purchase at a time. Funds buy the same bonds at the same prices.
tags: [performance, turns, index-funds, bonds]
badges: [patch]
areas: [backend]
---

## What changed

- Each index fund's bond purchases for the turn are sized and priced exactly as before, then settled together so they all land or none do.
- If anything changes between pricing and settlement, for example a player buying the same issue at that moment, the fund falls back to buying one bond at a time as it did before.
