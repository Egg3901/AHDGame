---
date: 2026-09-21
title: Skip policy stance hydration for NPPs who already voted
summary: >-
  The hourly turn now loads detailed NPP policy stances only for legislators
  who still have a vote to cast on an active federal or state bill.
tags: [turn performance, npps, legislation]
badges: [patch]
areas: [engine]
---

## What changed

- Bill, chamber, country and deadline routing is checked before loading large
  policy stance maps from NPP documents.
- Catch-up voters still load every stance needed for the bills currently on
  the floor, while legislators whose vote is already recorded skip that work.
