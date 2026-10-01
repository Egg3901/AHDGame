---
date: 2026-10-01
title: Aged-world turn benchmark script
summary: >-
  A developer script that restores an aged sandbox world and times real turns
  against it, so turn performance changes are measured on a mature world.
tags: [performance, tooling]
badges: [patch]
areas: [backend]
---

## What changed

- `scripts/perf/aged-benchmark.ts` restores a world snapshot into a local scratch database, runs warm-up and measured turns, and prints per-subsystem time and the slowest sub-steps.
- Local, sandbox-only: it refuses a non-local database, any target not named `ahd_sim_bench_*`, and any world not marked as a sandbox.
