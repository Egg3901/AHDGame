---
date: 2026-09-09
title: Party leadership hid the real race behind an empty duplicate
summary: >-
  The party page could show an empty leadership race and still block you from
  entering another seat because you were already on the real one. It now shows
  the race that actually has candidates, so withdraw and switch work.
tags: [elections, parties]
badges: [patch]
areas: [backend]
---

## What changed

- National, committee, and state party pages pick the earliest still-open
  race for each seat when two voting elections exist, matching enter and vote.
- Partial unique indexes refuse a second voting election for the same seat.
- The turn sweep that opens missing races ignores a duplicate-key collision
  instead of failing the phase.
