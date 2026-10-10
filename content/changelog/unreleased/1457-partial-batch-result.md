---
date: 2026-10-10
title: Batch actions now report a partial run instead of an error
summary: >-
  When a x5 or x10 action runs out of action points part way, the actions that
  already ran now show as a partial success and your points and funds refresh,
  instead of an error that hid what was spent and earned.
tags: [actions]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- A batched action that stops early (for example Fundraise x10 with only enough action points for 8) now reports "Stopped after 8 of 10" with the reason and the total result.
- Your action points and campaign funds refresh on screen after a partial run. Before, the page showed an error and stale numbers even though the earlier runs had been paid out.
