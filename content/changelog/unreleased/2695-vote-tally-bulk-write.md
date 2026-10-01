---
date: 2026-10-01
title: Vote totals saved together each turn
summary: >-
  Each turn's vote counts for every open race are saved in one batch instead of one race at a time.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Vote accumulation records every race's new totals in a single write at the end of the step, with identical results.
