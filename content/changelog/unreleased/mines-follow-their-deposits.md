---
date: 2026-10-13
title: New mines open where the ore is
summary: >-
  Computer-run mining companies chasing a rare earth shortage now open and grow
  mines only in regions that actually hold rare earth deposits.
tags: [economy, extraction]
badges: [patch]
areas: [engine]
---

## What changed

- A shortage-driven mine founding now targets a region holding that resource, so rare earth mines open on rare earth deposits instead of in timber regions where they could never extract any.
- Existing mines grow only against the deposit of the resource they actually mine, and a mine that cannot reach a short resource no longer jumps the reinvestment queue for it.
- Entry and reinvestment decisions for mines read the prices of resources their region holds, so a rare earth shortage no longer pulls new capacity into regions that can only add timber.
