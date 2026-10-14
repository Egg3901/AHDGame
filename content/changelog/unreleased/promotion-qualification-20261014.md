---
date: 2026-10-14
title: Qualify releases faster and reuse identical staging checks
summary: >-
  Spread unit tests across six shards and reuse successful staging qualification
  for an identical main-server promotion. Missing or mismatched proof runs the
  full checks, and existing security scans and deployment checks stay in place.
tags: [ci, qualification]
badges: [patch]
areas: [backend]
---

## What changed

- Keep every unit test while reducing work per hosted runner from four shards to six.
- Record the exact tested Git tree in native GitHub Actions qualification jobs.
- Reuse a recent full development-to-staging qualification for the same staging-to-main
  tree, including the matching main-branch push, after verifying workflow, repository,
  branch, run, native job and required security-gate provenance.
- Run the full checks when a receipt is missing, stale, failed or inconsistent.
