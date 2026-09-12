---
date: 2026-09-12
title: Repair permanent head-of-state governments on local load
summary: >-
  Existing permanent head-of-state worlds now restore their canonical
  parliamentary government formation when the local server starts.
tags: [singleplayer, government]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Existing local head-of-state worlds now idempotently pair the player's
  executive office with `governmentFormations`, including one-party states.
  Executive and legislature views therefore agree after an update without
  requiring a new world.

- Stop labeling unexplained idle extraction capacity as a measured deposit shortage. The resource panel continues to show each resource limit.
