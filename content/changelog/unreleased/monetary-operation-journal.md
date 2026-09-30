---
date: 2026-09-30
title: Reliable monetary-operation delivery
summary: >-
  Bond purchases, bond sales and treasury advances retain their original
  operation record through retries and interrupted delivery.
tags: [banking, economy]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Monetary requests retain one command identity through retries.
- Bond exchanges, market payments and treasury credits use durable settlement records.
- Treasury accounting retains its original currency valuation.
