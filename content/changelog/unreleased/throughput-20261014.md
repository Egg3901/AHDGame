---
date: 2026-10-14
title: Run slow bootstrap qualification beside unit shards
summary: >-
  Release checks run the full-world bootstrap qualification alongside the unit
  test shards, reducing waits while preserving every existing test and gate.
tags: [ci, qualification]
badges: [patch]
areas: [backend]
---

## What changed

- Give the full shipping-preset bootstrap test its own required CI job, so one
  long-running fixture cannot hold up a unit test shard.
- Require successful bootstrap qualification in the existing verify gate;
  failed, cancelled, skipped or missing results block the full check.
