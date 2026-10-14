---
date: 2026-10-14
title: NPP ministers read and write their levers in batches
summary: NPP and caretaker ministers now load their settings and active orders once per country and save tier changes and new orders in one write each, with the same decisions as before.
tags: [npp, autonomy, performance]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Each country's ministers load their seat settings and active orders in two queries instead of two per minister.
- Tier changes are saved in one batched write and new orders in one insert per country.
- A minister spends its actions for all of its orders in one guarded write. If its pool turns out to be short, it falls back to spending one action per order, as before, and issues only what the pool covers.
- Later ministers in the same country see earlier ministers' changes exactly as they did when each minister read the database on its own.

## Scope

Decisions are unchanged at every autonomy level. This applies to NPP governments and to caretaker ministers in player countries.
