---
date: 2026-09-30
title: Inspect background macro countries on the world map
summary: >-
  Background countries with seeded aggregate data now have distinct map borders,
  tap and click inspection, and a country picker with clearly labeled macro summaries.
tags: [world, map, mobile]
badges: [patch]
areas: [fullstack]
---

## What changed

- Inspect population estimates, economic system, stability, trade exposure and macro update timing for active background countries.
- The country picker includes countries without map shapes. Full political controls remain limited to supported countries.
- Summaries identify their coarse estimate provenance and exclude retired data and data from other presets.
- Mobile taps are consumed once; drags and cancelled gestures do not select another country. The inspector remains scrollable outside map gesture handling.
- The map legend uses the same four country tiers as its renderer.
