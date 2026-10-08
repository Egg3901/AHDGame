---
date: 2026-10-07
title: Turn steps read the world era once
summary: >-
  Each step of a turn now reads which era the world is in once, instead of
  every time a calculation needs it.
tags: [turns, performance]
badges: [patch]
areas: [backend]
---

## What changed

- During a turn, the world's era is looked up once per step and reused, which removes about 180 database reads from the banking step alone. Outside turns it is still read fresh every time, so a world reset is always picked up.
