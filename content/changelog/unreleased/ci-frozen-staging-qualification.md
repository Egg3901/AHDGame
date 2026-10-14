---
date: 2026-10-15
title: Reuse qualification for exact release snapshots
summary: >-
  Avoid repeating full CI for identical staging promotions when a frozen release
  snapshot has verified protected-development ancestry and complete native checks.
tags: [ci, performance]
badges: [patch]
areas: [backend]
---

## What changed

- Allow immutable source snapshots to supply an existing staging qualification.
- Verify protected-development ancestry, the exact source tree and trusted workflow configuration.
- Retain native full-check and security receipts, freshness limits and full-check fallback when evidence is incomplete.
