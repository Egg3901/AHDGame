---
date: 2026-10-01
title: Faster market-cap snapshot
summary: >-
  The end-of-turn market-cap snapshot no longer scans every corporation's full
  history to find its previous credit rating.
tags: [performance, turns, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- Each corporation's previous credit rating is read from its newest history row, and older history is only searched for corporations whose newest row has no rating. Rating-change notices and wire headlines fire exactly as before.
