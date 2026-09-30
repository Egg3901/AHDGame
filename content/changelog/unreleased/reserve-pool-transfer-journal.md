---
date: 2026-09-30
title: Reliable reserve-pool transfers
summary: >-
  Transfers between central-bank reserve pools retain their original command
  through retries and interrupted delivery.
tags: [banking, economy]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Reserve-pool cash and the existing transfer cooldown commit together.
- Retried requests return the original result and retain one audit record.
- Existing authority, limits and reserve-pool amounts are preserved.
