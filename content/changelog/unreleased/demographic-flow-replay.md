---
date: 2026-10-04
title: Resume interrupted population updates safely
summary: >-
  Population turns preserve their computed cohort vectors and regional readouts
  until every target write finishes, avoiding repeated aging or migration on retry.
tags: [population, reliability]
badges: [patch]
areas: [engine, backend]
---

Interrupted population turns resume their stored output before later turn phases
read it. Completed turns preserve subsequent edits when replayed. Reset assigns
a distinct world identity so previous-world receipts cannot qualify for a new world.
