---
date: 2026-10-07
title: The audit anomaly scan no longer exhausts server memory
summary: >-
  The post-turn audit scan loaded every audit row from the last six turns,
  including a system copy of every turn money movement, and could push the
  server into its memory watchdog restart. It now reads only rows a detector
  can flag and finds the same anomalies.
tags: [stability, security]
badges: [hotfix]
areas: [backend]
---

## What changed

- The audit anomaly scan filters in the database to rows a detector can act on:
  rows with a player or character actor, player, NPP or admin actors, admin
  actions, and party funding rows during a pre-election window. The system
  copy of each turn money movement stays in the database.
- Rows stream into a compact form instead of loading every projected document
  at once, and names, references and metadata other than the agreement id are
  no longer read.
- The fan-in and fan-out finding still reports how many system settlement rows
  it excluded; those rows are now counted in the database.
- `scannedRows` on the scan summary now counts candidate rows, not every row in
  the window.
