---
date: 2026-10-17
title: Fix national unemployment and labor demand rollups
summary: >-
  National unemployment now uses the labor force as its denominator, and labor
  demand and tightness are rolled up from a complete, same-turn snapshot.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, unemployment]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- National unemployment rates are weighted by each region's labor force, while
  the national labor-force metric is summed as a headcount.
- Corporate demand is written for every region, including zero-demand regions.
  Tightness is calculated after the metric engine computes the same turn's
  labor-force estimate, avoiding a stale-demand/current-supply mismatch.
- National demand and tightness are only shown when regional coverage is
  complete for the current turn.
- Missing regional demographic cohort stocks can be backfilled without
  resetting regions that already have evolving cohorts.
