---
date: 2026-10-07
title: Restore health metric refresh after a missed turn
summary: Health proxies read current regional performance boards and metric refresh can recover after a failed turn.
tags: [metrics, turns, health]
badges: [hotfix]
areas: [engine]
---

- Health access and waiting proxies use the current regional board where the legacy health store has been retired, with explicit proxy provenance and country checks.
- After a missed refresh, overdue owners provide current readings. Missing historical turns are not fabricated; settlement still uses the last persisted turn and exact replay checks.
