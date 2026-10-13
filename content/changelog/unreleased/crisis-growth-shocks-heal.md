---
date: 2026-10-13
title: Crisis growth shocks now fade after the crisis ends
summary: >-
  Crises that hit GDP growth no longer leave a permanent drag once they resolve,
  and a crisis can no longer lift growth in a region that was already shrinking.
tags: [economy, crises]
badges: [patch]
areas: [backend]
---

## What changed

- A crisis growth shock now fades by about a tenth each turn after it stops applying, instead of staying in place for the rest of the game.
- Growth shocks can now push regional growth below zero. Before, regions already shrinking were raised to zero growth by a negative shock.
- Regions still dragged by earlier crises (including the Energy Crisis) will recover their growth over the next several turns.
