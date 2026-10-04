---
date: 2026-10-04
title: Match tariff inflation to delivered imports
summary: >-
  Tariff inflation follows modeled household import purchases and their
  delivered duties instead of applying statutory rates across the whole economy.
tags: [economy, trade]
badges: [patch]
areas: [engine]
---

## What changed

- Use delivered import exposure from active commodity sourcing for the direct household tariff inflation channel.
- Keep production input duties visible separately, along with domestic and imported purchase values.
- Keep no-import markets neutral and distinguish missing or simulated coverage from measured zero exposure.
- Show the same exposure basis in central bank and inflation diagnostics.
