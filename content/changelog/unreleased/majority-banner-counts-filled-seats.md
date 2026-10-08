---
date: 2026-10-09
title: Majority banner counts filled seats
summary: >-
  The "needed for majority" line on chamber pages now counts only filled seats,
  matching how votes are actually decided.
tags: [legislature, ui]
badges: [patch]
areas: [frontend]
---

## What changed

- The majority banner on legislature and election pages now measures against the seats that are actually filled, and shows how many are vacant.
- Votes already worked this way. The banner was the only place still counting empty seats.
