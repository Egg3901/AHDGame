---
date: 2026-10-01
title: War resolution reliability and combat balance
summary: Keep war outcomes recoverable while reducing extreme results in evenly matched battles.
tags: [military, balance, reliability]
badges: [patch]
areas: [engine, backend]
---

## Balance changes

- Battle fortune still uses a 0.50 outcome spread to preserve displayed win-probability calibration, while the ratio used for casualty and readiness severity is now capped to 0.18 from parity. On the active Russia versus East Germany and United Kingdom front, a 2,000-seed replay produced 53.1% attacker wins against 51.1% displayed odds. Decisive victories plus routs measured 16.9%, down from 47.5% in the audit baseline.
- Reserve leverage now applies symmetrically to attackers and defenders. Equal reserve shares cancel instead of giving only the attacker an odds bonus.
- Scarce replacement manpower is divided proportionally across damaged formations instead of being drained in database order.
- Retreat discounts now apply to personnel, materiel, and readiness losses rather than personnel alone.

These changes apply immediately to existing and new worlds. They do not rewrite completed battles.

## Reliability changes

- Battle reports, unit losses, experience, equipment, and front movement commit together on transaction-capable deployments, with the supported sequential path retained for standalone local worlds.
- Peace acceptances keep a resumable settlement plan. Negotiated indemnities commit together on transaction-capable deployments and use per-treasury replay receipts on standalone Mongo.
- Naval and air operations and blockade closure continue through a conflict's winding-down phase, matching land combat.
- Battle input order is stable across database return order.
