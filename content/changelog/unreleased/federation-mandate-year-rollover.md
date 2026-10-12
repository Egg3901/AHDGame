---
date: 2026-10-12
title: Government formation no longer fails at the new year
summary: >-
  On the turn the year changed, the automatic federation proposal for
  Czechoslovakia or Yugoslavia could fail and stop government formation for
  that turn. It now waits for the new year properly.
tags: [politics, fix]
badges: [patch]
areas: [engine]
---

## What changed

- The automatic federation proposal now checks the game's own year before opening, so the turn the year changes no longer fails.
- If one country's proposal cannot open, government formation still runs for everyone else and the proposal is tried again next turn.
