---
date: 2026-10-07
title: Fewer database writes when payments record their receipts
summary: >-
  Payments that record receipts now mark them done in a single write instead
  of one write per receipt. Index-fund payouts and other settlements finish
  with fewer database calls each turn.
tags: [turns, performance, banking, index-funds]
badges: [patch]
areas: [backend]
---

## What changed

- When a payment writes its receipts, they are marked done in one journal update at the end rather than one update per receipt. A payment interrupted partway still finishes on the next turn without duplicating any receipt.
