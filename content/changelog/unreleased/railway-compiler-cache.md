---
date: 2026-10-14
title: Preserve compiler cache with targeted build recovery
summary: >-
  Production builds retain compiler work between deployments instead of always
  starting cold. A recognized cache-corruption failure gets one clean retry;
  other build failures still stop the deployment.
tags: [performance, builds]
badges: [patch]
areas: [backend]
---

## What changed

- Keep the compiler cache on normal builds. A successful full build is still required.
- Clear compiler-cache contents and retry once only after a recognized persistence bounds panic.
- Preserve cache mount points and fetch-cache contents during recovery. Runtime response caching is unchanged.
- Keep explicit recovery available with `npm run build:clean-cache`. Unrecognized errors and unsuccessful retries fail normally.

## Validation

- Executable fixtures cover retained caches, corruption recovery, failure propagation, cancellation, mount preservation and the normal build/postbuild command sequence.
- Hosted cold and warm deployment timings remain to be measured after release.
