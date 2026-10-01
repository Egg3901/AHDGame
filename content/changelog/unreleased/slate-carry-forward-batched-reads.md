---
date: 2026-10-01
title: Faster slate carry-forward during turns
summary: >-
  The turn step that carries party slate boards into newly opened primaries now
  loads everything it needs in a few batched reads instead of several per race.
tags: [performance, turns, slates]
badges: [patch]
areas: [backend]
---

## What changed

- Carrying a prior-cycle slate board into a new primary picks the same template as before (newest prior cycle with a matching senate or chamber class, then most recently updated), but the turn now resolves every race's template, its rows, and the named NPPs and players together.
- No change to which candidates carry forward or how they respond.
