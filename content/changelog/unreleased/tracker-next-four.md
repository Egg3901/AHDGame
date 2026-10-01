---
date: 2026-09-29
title: Publish reproducible NPP corporation diagnosis
summary: >-
  Add a sandbox diagnosis report showing which expansion and spending gates
  constrain NPP corporations, alongside exact-turn cash-negative metrics by sector.
tags: [economy, corporations, telemetry]
badges: [patch]
areas: [engine]
---

## What changed

- Publish retained per-sector gate counts and cash-history regression series.
- Add a read-only sandbox collector that separates decision and cash-history timestamps.
