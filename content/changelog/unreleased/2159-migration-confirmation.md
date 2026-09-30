---
date: 2026-09-30
title: Preserve existing-world campaign pricing during migration and reseeding
summary: >-
  Existing worlds keep their campaign pricing when configuration is migrated or
  seed data is topped up. Migration requests now reject unknown selections and
  unsafe forced reruns before making changes.
tags: [campaigns, maintenance]
badges: [patch]
areas: [backend]
---

## What changed

- Preserved legacy campaign pricing for existing worlds, including worlds with an absent pricing flag.
- Kept deliberate resets and fresh worlds on the current campaign pricing defaults.
- Rejected unknown migration IDs, empty or conflicting selections, and forced non-idempotent migrations before execution.
