---
date: 2026-10-05
title: Architecture cleanup
summary: >-
  Large modules were split along their existing seams and dead code was removed,
  with no change to gameplay.
tags: [engine]
badges: [patch]
areas: [backend, frontend]
---

## What changed

- Oversized modules (seed manifest, sector strategies, era band curves, decade
  events, election enrichment, fund cron, supply settlement, UK conference and
  cabinet handlers, party election notifications) were split into focused files.
  Public exports are unchanged.
- Client components no longer import server-only modules for plain constants,
  and the party and legislature views read shared rules from domain modules
  instead of turn internals.
- Unused components and forwarder files were deleted.
