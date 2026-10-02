---
date: 2026-10-03
title: Lighter, faster 1991 front page
summary: >-
  The 1991 front page drops the special report strip and the headline crawl,
  and the globe spins on far less work per frame.
tags: [landing, 1991, performance]
badges: [patch]
areas: [frontend]
---

## What changed

- The 1991 front page no longer shows the red "Special report" strip above the headline or the headline crawl along the bottom. The satellite beams still name the year's datelines on the globe.
- The front page globe draws each frame with about a third of the work it did before. Countries facing away are skipped, countries facing the viewer are drawn directly, and only those crossing the edge of the globe take the slow path.
- Player-count chips and the history cards no longer force the browser to measure the page on every frame.
- The old Soviet border's slow pulse now runs with the globe's own frames instead of repainting the globe on its own.
