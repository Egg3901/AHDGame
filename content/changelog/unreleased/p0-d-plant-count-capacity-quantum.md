---
date: 2026-10-04
title: Plant counts follow owned capacity
summary: >-
  Plants sectors now reconcile facility counts and residual capacity from owned
  capital stock on every capacity write, including turn depreciation. Merges
  combine stock before counting facilities, and ownership carves allocate
  stock by the whole facilities actually transferred so fractional stock and
  paid basis remain conserved. Incremental capacity writes now derive the
  ledger atomically from post-update stock, including concurrent changes.
tags: [corporations, economy]
badges: [patch]
areas: [engine]
---

## What changed

Facility counts and residual capacity are reseeded from capital stock on every
plants capacity write. A carve transfers stock according to the whole
facilities allocated, and merges count facilities from combined stock.
Concurrent capacity deltas derive `plantCount` and `plantUnitRemainder` from the
resulting document stock. A carve of one 400-unit energy facility at a 50%
requested share transfers the indivisible facility and all 400 units; the
helper requires both conserved whole-facility counts before it can split a
typed plant row.
