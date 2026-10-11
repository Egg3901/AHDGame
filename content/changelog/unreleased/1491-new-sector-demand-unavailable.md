---
date: 2026-10-11
title: Expand sector no longer loses buyer demand when a new competitor appears
summary: >-
  The Expand sector dialog could say buyer demand was unavailable for every
  output whenever a company had founded or bought a sector making the same goods
  since the last turn. It now counts that sector as having no output yet.
tags: [corporations, interface]
badges: [minor]
areas: [frontend]
---

## What changed

- A sector founded or bought since the last turn has not produced anything yet. The Expand sector dialog treated that as missing data and showed "Buyer demand unavailable" for every company making the same goods, until the next turn. It now counts the new sector's capacity and queued builds as unused room, so the measured demand and Match demand estimate stay available.
