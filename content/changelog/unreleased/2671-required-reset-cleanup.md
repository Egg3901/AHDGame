---
date: 2026-09-30
title: Reset clears stale wars and reports required cleanup failures
summary: >-
  A reset now clears stale wars and other runtime records that were incorrectly
  excluded from cleanup, and reports any required cleanup failure.
tags: [reset, conflicts, reliability]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Runtime collections are selected by their declared lifecycle category, including conflicts and peace offers.
- Required cleanup errors stop reset before the new world clock is initialized and identify the affected collections.
- Missing collections remain valid on clean or repeat resets.
- Every scheduled cleanup operation finishes before a failure is reported, avoiding background cleanup after the failed reset returns.
