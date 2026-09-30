---
date: 2026-09-30
title: Keep long simulation reports readable
summary: >-
  Large approval and economic telemetry exports are stored in bounded chunks,
  preserving complete reports when they exceed the database document limit.
tags: [simulation]
badges: [patch]
areas: [backend]
---

## What changed

- Preserve complete nested telemetry with a versioned chunk manifest.
- Continue reading earlier inline and chunked reports.
- Allow explicit source-pinned recovery of reports from completed sandbox simulations without advancing the world.
