---
date: 2026-10-03
title: Corporation and sector screens drop dash placeholders
summary: >-
  Empty values on corporation and sector screens read n/a, none or 0, and
  dashes in their sentences became plain punctuation.
tags: [corporations, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Missing figures on the sector detail page, the expand market dialog, the strategy change preview, share dialogs and the nationalization card read "n/a" instead of a dash. Values that are really zero say "0" or "none", for example a supply or demand line that a strategy change leaves empty, or an auction with no bids yet.
- Titles, tooltips and notices on these screens use a colon, a full stop or a comma where they used a dash, for example "Bond default: action required" and "Queued: fills when price drops to".
