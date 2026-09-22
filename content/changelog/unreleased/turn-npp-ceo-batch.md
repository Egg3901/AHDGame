---
date: 2026-09-18
title: Guard batched NPP corporation-founding CEO reads
summary: >-
  Regression coverage now pins the single batched CEO-seat read used by the
  NPP corporation-founding sweep.
tags: [economy, corporations, performance]
badges: [patch]
areas: [engine]
---

## What changed

- A test pins the existing batched `find({ ceoId: { $in: [...] } })` read, so a
  per-candidate `findOne` cannot come back quietly.

## Why it matters

The multiplayer turn is round-trip bound. This coverage protects a previously
merged fix that replaced one Mongo round trip per qualifying candidate with one
read for the whole founding pool.
