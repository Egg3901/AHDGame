---
date: 2026-10-07
title: Resumed turns keep completed bond settlement results
summary: >-
  A turn resumed after a restart now reuses the bond settlement it already
  completed, so treasury cash settles once from the real bond flows.
tags: [turns, bonds, treasury, reliability]
badges: [patch]
areas: [engine]
---

## What changed

- When a restart interrupts a turn after bond settlement, the resumed turn reuses that settlement's recorded flows for treasury cash instead of stopping. Bond payments are never applied twice.
- If those flows were not recorded, or bond settlement itself was cut off part way, the turn stops with a clear repair message rather than settling the treasury with guessed amounts.
