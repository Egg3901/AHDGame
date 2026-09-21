---
date: 2026-09-21
title: Reduce election vote accumulation reads
summary: General-election sweeps share candidate, endorsement and country-level lookup data across races.
tags: [performance, elections]
badges: [patch]
areas: [engine]
---

- Active candidate actors, NPP endorsements and executive endorsements load once per vote sweep instead of once per election.
- Party-group favorability and party metadata are reused across elections in the same country and turn.
- Mutable one-party-state election overrides remain live per election so one-shot honest-election behavior is unchanged.
