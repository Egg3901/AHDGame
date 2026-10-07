---
date: 2026-10-07
title: Payment receipts are written together
summary: >-
  When a payment records several receipts, such as ledger entries, transaction
  log rows and audit rows, they are now written at the same time instead of one
  after another.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- A payment's receipt rows are written together rather than in sequence, so each payment finishes sooner. Each receipt is still written exactly once, including after an interrupted payment.
