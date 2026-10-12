---
date: 2026-10-12
title: Sector market support no longer drops all at once
summary: >-
  A recent change shortened the market support window for every sector
  founded during play in a single turn, which cut revenue sharply for many
  companies. Each sector is back on its own support window, and market
  support will be phased out in small steps instead.
tags: [economy, corporations, fix]
badges: [patch]
areas: [engine]
---

## What changed

- Each sector's market support window runs from the turn it started again.
- Market support can now be phased out for every sector over a set number of turns, so sector revenue moves to full market prices in small steps instead of one jump. The sector page's market support countdown shows the earlier of the sector's own window and the phase-out.
