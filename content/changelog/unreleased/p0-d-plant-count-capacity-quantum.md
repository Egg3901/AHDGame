---
date: 2026-10-04
title: Plant counts follow owned capacity
summary: >-
  Plants sectors now reconcile facility counts and residual capacity from owned
  capital stock on every capacity write, including turn depreciation. Merges
  combine stock before counting facilities, and ownership carves allocate
  stock by the whole facilities actually transferred so fractional stock and
  paid basis remain conserved.
tags: [corporations, economy]
badges: [patch]
areas: [engine]
---

## What changed

Facility counts and residual capacity are reseeded from capital stock on every
plants capacity write. A carve transfers stock according to the whole
facilities allocated, and merges count facilities from combined stock.
