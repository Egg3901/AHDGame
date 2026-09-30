---
date: 2026-09-30
title: Accurate turn timing breakdowns for performance work
summary: >-
  A read-only report splits each turn's time across the systems that were running, without double counting.
tags: [performance, tooling]
badges: [patch]
areas: [backend]
---

## What changed

- Turn performance reports attribute overlapping phases fairly instead of adding their times together, and group them by subsystem and by the 4-turn and 24-turn cadences.
