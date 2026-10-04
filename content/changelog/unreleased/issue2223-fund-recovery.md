---
date: 2026-10-03
title: Queued fund payouts retain their original settlement during recovery
summary: >-
  Queued fund redemptions resume their original payout after an interrupted turn.
  Recovery keeps the accepted amount and completes the payment records once.
tags: [economy, funds]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Queued payouts retain their accepted NAV and currency conversion during recovery.
- The next fund turn finishes interrupted payments before pricing or trading.
