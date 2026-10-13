---
date: 2026-10-12
title: Plant pages quote the real shortage floor
summary: >-
  The inputs panel and throughput tooltip now show the lowest throttle an input
  shortage can actually apply to a plant, instead of always saying 50%.
tags: [economy, corporations]
badges: [patch]
areas: [frontend]
---

## What changed

- When a shortage holds a plant back, the sector page now states the true floor the game applies (85% under current settings), so a plant pinned there is no longer told it could be cut to 50%.
- The input throughput tooltip uses the same floor.
