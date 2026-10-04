---
date: 2026-09-28
title: Smooth historical capacity price progression
summary: Historical capacity price levels now progress between calibration years without abrupt era-boundary jumps.
tags: [economy, balance]
badges: [patch]
areas: [engine]
---

## What changed

Capacity prices retain their authored calibration levels in 1953, 1971, 1979, 1991 and 1999. Prices between those years now change gradually, removing the single-year era step. Missing years and years outside the calibration range retain the existing endpoint behavior.
