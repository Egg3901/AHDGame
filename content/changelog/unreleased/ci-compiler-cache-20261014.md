---
date: 2026-10-14
title: Reuse compiler work between CI builds
summary: >-
  Persist the Next.js compiler cache between eligible CI builds while retaining
  the full production build and every existing correctness and security check.
tags: [ci, performance]
badges: [patch]
areas: [backend]
---

## What changed

- Cache only Turbopack compiler data, scoped by platform, dependencies and build configuration.
- Restore compatible compiler data when source files change, then run the full build.
- Treat unavailable caches as a normal build and discard incomplete restores.
- Keep runtime data and generated application output out of the shared cache.
