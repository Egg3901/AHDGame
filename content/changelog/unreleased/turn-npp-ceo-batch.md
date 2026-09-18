---
date: 2026-09-18
title: Read NPP corporation-founding CEO seats once per sweep
summary: >-
  The NPP corporation-founding sweep asked "is this NPP already a CEO?" with one
  Mongo query per candidate. It now resolves the whole candidate pool in a
  single `$in` read, cutting a round trip per candidate off the turn.
tags: [economy, corporations, performance]
badges: [patch]
areas: [engine]
---

## What changed

- `foundNppCorporationsSurplus` collects the candidate ids and reads their existing
  CEO seats once with `find({ ceoId: { $in: [...] } })`, instead of issuing a
  `findOne({ ceoId })` inside the candidate loop.
- A test pins the batched read, so a per-candidate `findOne` cannot come back quietly.

## Why it matters

The multiplayer turn is round-trip bound, and this sweep — which runs every fourth
turn — spent a Mongo round trip for every candidate that cleared its founding roll.
The predicate is unchanged, and `nppFoundCorporation` keeps its own re-check for its
other callers, so the new read is a short-circuit rather than the only guard.
