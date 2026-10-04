---
date: 2026-10-03
title: Accounting covers nationalization buyouts and privatization sales
summary: Cash checks now record whole-corporation buyouts, privatization proceeds and auction escrow.
tags: [accounting, nationalization]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Record the treasury's buyout pool, each shareholder's payout and the public float's share when a whole corporation is nationalized.
- Record the remaining cash of a nationalized corporation as it passes to its CEO and the treasury.
- Record privatization IPO proceeds, auction bids, refunds and the winning payment.
