---
date: 2026-09-18
title: Targeted ad audiences are grouped by demographic
summary: >-
  The targeted ads audience list now groups age with age, income with income,
  and the rest of each country's voter categories, using the same names as
  other campaign targeting.
tags: [elections, campaigns, ui]
badges: [patch]
areas: [fullstack]
---

## What changed

- Audience choices in Targeted ads sit under their demographic heading instead
  of appearing in the order of whichever voter cell loaded first.
- Labels match the country's own campaign targeting names, so "50s and 60s"
  sits with Age rather than as "age: mature".
