---
date: 2026-10-07
title: One less database read per payment
summary: >-
  A payment no longer reads back the record it has just written before moving
  money, saving a database call on every payment the turn makes.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- Each new payment starts from the record it just wrote instead of reading it back. Every payment step still checks the stored record before it writes, so payments interrupted or resumed elsewhere behave exactly as before.
