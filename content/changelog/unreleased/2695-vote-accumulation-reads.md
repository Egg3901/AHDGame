---
date: 2026-10-01
title: Faster vote counting each turn
summary: >-
  Vote accumulation reads each election's incumbency history and country settings once per turn instead of once per race.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Incumbent seat shares for every open race are loaded together, and country settings are shared across races, with identical results.
