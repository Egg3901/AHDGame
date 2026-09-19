---
date: 2026-09-18
title: Expand anonymous single-player telemetry aggregates
summary: >-
  Local single-player statistics reports can include GDP, population,
  inflation, unemployment, approval, election counts, and government
  formation totals, still without names, ids, or save documents.
tags: [client, singleplayer, telemetry]
badges: [patch]
areas: [backend]
---

## What changed

- Keep the existing anonymous opt-in upload path and 30-day raw retention.
- Let the local exporter fill GDP, population, growth, inflation, unemployment, approval or stability, election counts by status, government formations, legislative seat totals, and executive-control share when those values exist.
- Stamp a metric-definition version so later dashboards do not connect incompatible series.
- Older clients keep working: missing metrics stay omitted instead of being invented.
