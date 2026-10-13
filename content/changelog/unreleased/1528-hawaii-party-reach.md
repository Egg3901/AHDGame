---
date: 2026-10-13
title: Island regions are within every party's reach
summary: >-
  Regions with no land neighbours, such as Hawaii, no longer show as out of
  reach for parties that are established elsewhere.
tags: [parties, npps]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- Parties grow one neighbouring region at a time, but Hawaii has no neighbours, so a party without a foothold there could never recruit or relocate a politician into it. Island regions with no land neighbours now count as next to every region, so any party with presence somewhere can reach them.
- Players homed in those regions can likewise join any party that is established somewhere in the country.
