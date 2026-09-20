---
date: 2026-09-20
title: Lighter turn progress and clock reads
summary: Turn progress polling and server clocks share smaller database reads.
tags: [performance, turns]
badges: [patch]
areas: [backend]
---

- Multiplayer turn progress polls share a short-lived projected snapshot, reducing database contention while a turn runs.
- Server clocks reuse pause information and share simultaneous reads.
- Clock reconciliation has indexes matching the current world's turn history.
