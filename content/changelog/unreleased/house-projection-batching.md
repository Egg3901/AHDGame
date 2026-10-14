---
date: 2026-10-14
title: Faster US House seat projections
summary: US House seat projections now load district data once across eligible races instead of race by race, with the same projected results.
tags: [elections, performance]
badges: [patch]
areas: [backend]
---

US House seat projections now batch district data across eligible races, reducing repeated reads while preserving existing results.
