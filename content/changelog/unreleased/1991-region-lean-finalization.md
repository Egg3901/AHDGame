---
date: 2026-10-04
title: Missing regional political leans after world reset
summary: Newly seeded regions derive their electorate leans before the world opens.
tags: [1991, demographics, elections, reset]
badges: [patch]
areas: [backend, engine]
---

## What changed

- World reset now fills missing regional political leans from the new world's seeded demographics, including Japan and economy-tier countries.
- The state and demographic caches agree. Existing valid region leans remain unchanged.
- Regions with missing demographic data or weighted categories are reported instead of receiving invented neutral values.
