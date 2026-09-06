---
date: "2026-09-06"
title: Clear stale latent shortage diagnostics
summary: >-
  Commodity price rows now remove prior-turn truncation diagnostics when a
  commodity becomes uncapped, and remove only the unavailable multiple when
  supply reaches zero.
tags: [economy, commodities, diagnostics]
badges: [patch]
areas: [engine]
era: "Beta 2"
---

Cut from development.

## Fixed

- Commodity price persistence now explicitly unsets optional latent shortage
  fields absent for the current turn, while preserving history omission and
  existing price behavior.
- A zero-supply commodity keeps its measured truncated demand but clears any
  stale latent multiple that cannot be computed.
