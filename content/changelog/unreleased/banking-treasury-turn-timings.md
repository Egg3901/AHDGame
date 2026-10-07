---
date: 2026-10-07
title: Turn logs time the banking and treasury steps in detail
summary: >-
  Turn logs now record how long each part of the banking and treasury steps
  takes, so slow parts of a turn can be found and fixed.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- The banking step now records separate timings for recovering unfinished payments, loading banks, servicing deposit-taking banks, banks with only loans, loans owed to closed banks, interbank lending and bank treasuries.
- The treasury step records separate timings for loading and for working through each country's budget.
