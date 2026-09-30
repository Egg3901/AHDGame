---
date: 2026-09-30
title: Keep large federation relocations responsive
summary: >-
  Federation settlements preserve resident choices and wallets with batched
  database operations as the number of affected characters grows.
tags: [1991, succession, performance]
badges: [patch]
areas: [engine]
---

- Validate all affected residents before writing protected relocation holds.
- Batch character holds, office vacancies and durable relocation records.
- Preserve prior owner choices and reject conflicting relocation retries.
