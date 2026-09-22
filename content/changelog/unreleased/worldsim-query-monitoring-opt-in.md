---
date: 2026-09-20
title: Keep worldsim query diagnostics off the normal execution path
summary: Normal worldsims avoid Mongo command-monitor reply decoding. Explicit query profiling still records counts and budgets, while unmonitored phases omit unmeasured counters.
tags: [worldsim, performance, observability]
badges: [patch]
areas: [engine]
---

## Fixed

- Add `--profile-queries` for explicit worldsim command diagnostics; the existing monitoring and profiling environment flags remain supported.
- Keep phase elapsed times available during ordinary runs and stop reporting unmeasured query counts as zero.
