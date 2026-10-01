---
date: 2026-10-01
title: NPP capacity build history follows successful cash writes
summary: >-
  Failed NPP cash writes no longer leave phantom capacity spending in financial
  history. Successful builds retain their existing costs and accounting.
tags: [accounting, corporations]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Publish NPP capacity spending only after its actual cash operation lands.
- Preserve history for landed operations in partially failed batches.
- Make repeated history publication idempotent without charging cash again.
