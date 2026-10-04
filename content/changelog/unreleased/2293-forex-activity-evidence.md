---
date: 2026-10-05
title: Simulation reports show whether forex was actually traded
summary: >-
  Qualification runs now record forex orders, fills, volume, spread, intervention
  and unresolved orders, and say plainly when rate moves were macro-only.
tags: [economy, forex, simulation]
badges: [patch]
areas: [backend]
---

## What changed

- Economy telemetry for a simulation run includes a forex activity record: order count, fill rate, executed volume, spread, interventions and orders still unresolved.
- A world with forex enabled but no executed trades is marked unexercised, and its exchange-rate movement is labelled macro-only instead of being credited to market activity.
- Pure computer-controlled worlds have no character wallets, so they are expected to report unexercised; the actor coverage report already says this.
