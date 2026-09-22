---
date: 2026-09-22
title: Make game health and audit findings trustworthy
summary: >-
  Run status now separates turn completion from health severity and reports
  integrity findings. Audit scans pair ledger legs and ignore routine
  settlements so review queues show real anomalies.
tags: [telemetry, audit, worldsim]
badges: [patch]
areas: [backend, engine]
---

## Fixed

- A successful turn can remain successful while its game health reports
  integrity errors and warnings and stays non-passing.
- Worker status, MCP status, checkpoint reports, and executive summaries expose
  completion and health severity together.
- Audit anomaly scans treat mirrored ledger legs as one transfer, require a
  later reverse event for circular flow, and exclude routine settlements from
  generic funding-hub baselines.
