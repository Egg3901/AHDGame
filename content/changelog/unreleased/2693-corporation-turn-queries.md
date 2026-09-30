---
date: 2026-09-30
title: Faster corporation turns in long-running worlds
summary: >-
  Corporation history lookups and company removals no longer slow down as a world's history grows.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Latest-results lookups for corporations and index funds read one record per company instead of scanning the whole history.
- Removing a company no longer scans the entire transaction log to mark its records.
