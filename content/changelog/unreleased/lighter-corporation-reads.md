---
date: 2026-10-08
title: Lighter corporation reads during the turn
summary: >-
  The turn reads corporations without their internal payment history, which
  made up most of each record.
tags: [turns, performance]
badges: [patch]
areas: [backend]
---

## What changed

- Each corporation record carries a long internal history of the payments it has taken part in, which only the payment system itself uses. The turn's corporation, budget and state enterprise steps now leave that history out when they read corporations, so they move about a third less data. Nothing about corporations or their balances changes.
