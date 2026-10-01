---
date: 2026-10-01
title: Database indexes catch up on long-running worlds
summary: >-
  Worlds created before recent index additions receive them, so lookups that relied on them stop scanning whole tables.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- A one-time maintenance step adds indexes that newer worlds get automatically but older worlds never received.
