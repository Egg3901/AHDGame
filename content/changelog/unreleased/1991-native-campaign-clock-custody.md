---
date: 2026-10-03
title: Timer repair preserves native election campaigns
summary: >-
  Admin timer recalibration preserves Hungarian and Russian native campaign
  deadlines, rounds and receipts while correcting derived dates.
tags: [1991, hungary, russia, elections]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Hungarian first rounds, runoffs and constituency vacancy ballots retain their filing and ballot deadlines.
- Russian presidential, Duma and Council campaigns retain their native round and cohort identities.
- Timer repair preserves campaign status, cycle, candidates and recorded tallies. Malformed native clocks remain pending for their campaign owner.
