---
date: 2026-09-20
title: Reuse election scoring and notification reads during turns
summary: Election processing batches candidate and endorsement inputs across races and loads state-party election notification recipients once per opening sweep.
tags: [turn, performance, elections]
badges: [patch]
areas: [engine]
---

## Fixed

- Vote accumulation reuses candidate, endorsement, and country favorability inputs within a turn while preserving election-specific bonuses and live regime updates.
- State-party election openings read notification recipients in one country-scoped batch, including worlds with no player recipients.
