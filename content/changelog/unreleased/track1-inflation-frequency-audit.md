---
date: 2026-09-25
title: Clarified inflation timing
summary: >-
  The inflation rule now describes its turn-by-turn change limit in the game's
  48-turn year, with a deterministic calibration check across five years.
tags: [economy, inflation, calibration]
badges: [patch]
areas: [engine]
---

## What changed

- Corrected the annual arithmetic envelope documented for the inflation
  change limit and distinguished it from a typical realized path.
- Added a fixed-shock calibration table for 1, 12, 48, and 240 turns. No
  inflation balance parameters changed.
