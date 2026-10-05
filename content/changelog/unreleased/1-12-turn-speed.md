---
date: 2026-10-05
title: Turn speed
summary: >-
  Turns spend less time on the database, so large worlds finish faster.
tags: [performance, turns]
badges: [minor]
areas: [backend, engine]
---

## What changed

- Index fund rebalances settle as one recoverable batch, and the fund phase reads its data once per pass.
- Computer-run corporations skip strategy work when nothing is up for review.
- Union bargaining on computer-run turns does fewer database reads.
- A new benchmark and index check catch turn slowdowns before release.
