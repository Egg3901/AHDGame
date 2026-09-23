---
date: 2026-09-22
title: Reuse association prior lookups during electorate cell derivation
summary: >-
  Granular electorate cells now reuse pairwise association-prior lookups across
  cells in one derivation, reducing CPU work during turn-time election modeling.
tags: [elections, demographics, performance]
badges: [patch]
areas: [engine]
---

## What changed

- Resolve every pair of dimension buckets against the association-prior table
  once per derivation.
- Reuse those numeric factors when constructing each cell, preserving the
  original multiplication order and derived output.

## Why it matters

The turn CPU profile identified granular electorate cell derivation as a hot
path. On current `development`, four alternating 1,000-derivation rounds
reduced median time from 1,058 ms to 598 ms with byte-for-byte identical
output. A matched full-turn pair ran under variable shared-host load and is not
used as evidence for an end-to-end turn speedup.
