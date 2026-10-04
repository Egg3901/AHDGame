---
date: 2026-10-04
title: Capture source-qualified mining observations
summary: >-
  Optional sandbox observations retain mining strategy, market and deposit
  inputs alongside realized output and costs for balance qualification.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [simulation, mining, corporations, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Optional investment snapshots capture recipe input prices, deposit capacity,
  reachable books, sold commodity mix and selector configuration with batched,
  projected reads. File and directory permissions remain private.
- Qualified captures require a sandbox database and exact source, run and seed
  provenance. Unpinned captures are marked ineligible for qualification.
- Opening observations are labeled separately from completed turn observations.
  Strategy comparisons describe the same captured state; they do not reconstruct
  earlier decisions or establish causal profit differences.
