---
date: 2026-10-05
title: Reject wrong-era parties in 2027 world setup checks
summary: >-
  The 2027 world-setup check now fails when a seeded default party is not part
  of the 2027 roster, so dissolved or renamed parties cannot slip back in.
tags: [2027, world-setup]
badges: [patch]
areas: [backend]
---

## What changed

- The seed conformance report flags any default party outside the 2027 roster for its country as critical.
