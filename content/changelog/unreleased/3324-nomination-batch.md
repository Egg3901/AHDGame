---
date: 2026-10-07
title: Leadership pages read nominations once
summary: >-
  The Senate and House leadership pages now load every race's candidacies in a
  single read instead of one per role, so the pages open faster with the same
  candidates, order and vote state.
tags: [congress, leadership, performance]
badges: [patch]
areas: [backend]
---

## What changed

- The leadership page builder reads nominations for all roles at once, keeping each role's filter (open candidacies while voting, confirmed rows otherwise) and its vote and age ordering.
- Nominee avatars, borders and NPP avatars are read once for all roles instead of once per role, and skipped entirely when no role has nominations.
