---
date: 2026-10-03
title: Bulgarian constitutional handover preserves the ballot rules
summary: >-
  Untouched founding campaigns switch to ordinary Assembly counting together.
  Recorded votes, renewed polls and certified counts retain their original rules.
tags: [1991, bulgaria, elections]
badges: [patch]
areas: [backend, engine]
---

## What changed

- A complete untouched first-round cohort clears both its founding election flag and tally flag when its seats change to240.
- A runoff or journaled count cannot be mistaken for a new first round, even when its renewed tally has no votes.
- Capacity changes, count flags and constitutional authorization commit together and roll back together.
