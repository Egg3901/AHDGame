---
date: 2026-10-14
title: "NPP engine 6.13: autonomous central banks defend a falling currency"
summary: At autonomy v6, an NPP central bank chair sets a reserve-backed intervention band after a 15%+ currency fall over 24 turns and removes its own band once the move settles inside 5%.
tags: [npp, central-bank, currency, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- New `processNppCurrencyDefence`, called each chair turn for `chairMode: "npp"` banks after the rate setter, not gated on the rate cooldown.
- At autonomy v6, for a floating national currency with no band, a 24-turn fall of at least 15% sets an `interventionPolicy`:
  - ceiling at the current rate +5%, floor at -10%;
  - both clamped to the existing guardrails (0.5x and 1.5x base rate);
  - attributed to the chair NPP;
  - written only into an empty slot.
- The forex turn defends the band through the existing funding plan, which caps spending at available reserves. Breach infamy is charged only to a seated player chair, so it never applies here.
- The chair releases only its own band, after `INTERVENTION_POLICY_COOLDOWN_TURNS`, once the 24-turn move is within 5%.
- Excluded: player-set bands, government-controlled rates, `hardPeg`, non-float regimes, and common monetary policy.
- NPP engine version 6.13.0, recorded in the [NPP changelog](/changelog/npp). Covers the reserve half of the owner note from 2026-10-02.

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
