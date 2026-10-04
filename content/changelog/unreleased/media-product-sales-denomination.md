---
date: 2026-10-04
title: Media advertising settlement recovery
summary: >-
  Frozen advertising orders retry only their original seller credit, and later
  title obligations wait until the prior receipt is consumed.
tags: [media, products, banking]
badges: [patch]
areas: [backend, engine]
---

## What changed

- A refused seller credit can resume from its original quote after the seller's
  denomination guard is restored. The buyer debit is not repeated.
- Product advertising publishes at most one unconsumed receipt per owner, so
  legacy duplicate obligations cannot overwrite paid brand evidence.
