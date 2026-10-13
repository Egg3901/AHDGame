---
date: 2026-10-13
title: "NPP engine 6.6: autonomous central banks answer currency moves"
summary: At autonomy v6, an autonomous central bank chair adds an exchange-rate term to its Taylor target, hiking against a sharp currency fall and easing, more slowly, after a sharp rise.
tags: [npp, central-bank, currency, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, an NPP chair's rate target for a floating national currency adds an exchange-rate term:
  - the move is measured as the change in `exchangeRates.rate` against the newest snapshot at least 24 turns old;
  - beyond a 5% dead band, a fall adds 0.1 points per 1% and a rise subtracts at half weight;
  - the term is capped at 3 points either way.
- The term shifts only the target. The bounded step (0.5 of the gap, hike and cut caps), the 6-turn cooldown, the rate ceiling and the government-held-rate standing-advice path are unchanged.
- Pegs (`fxRegime` peg or band), admin hard pegs and members of a common monetary authority are excluded.
- The published rate history notes the currency move in the reason.
- NPP engine version 6.6.0, recorded in the [NPP changelog](/changelog/npp). Covers the central-bank half of the owner note from 2026-10-02; government fiscal responses are not included.

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
