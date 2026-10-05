---
date: 2026-10-05
title: Reset world state and enforce persistence contracts
summary: >-
  Fresh worlds now clear old diplomatic, political, electoral and transaction
  state. New persistence and turn query checks catch missing reset and index
  coverage before it ships.
tags: [reset, elections, politics, performance]
badges: [patch]
areas: [backend, engine]
---

- Clear world-owned ledgers, ballots, truces and telemetry while preserving accounts and moderation history.
- Reset electoral overrides, political effects and imperial wallets; keep imperial profile IDs unique.
- Clear old economic-model state and national rollups before building the new world's metrics.
- Remove retired regional metrics and keep archived membership events out of new-world analytics.
- Recreate reset-sensitive indexes and enforce collection, index and turn batching contracts in CI.
