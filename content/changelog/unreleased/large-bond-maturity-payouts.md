---
date: 2026-10-08
title: Large government bond maturities now pay out
summary: >-
  Some matured government bonds with very large face values were stuck unpaid
  because of a rounding check. They now settle and pay their holders.
tags: [economy, bonds]
badges: [patch]
areas: [engine]
---

## What changed

- Government bonds that matured but never paid out, mostly very large ones held by funds and players, now settle on the next turn.
- Holders receive their full face value, and the bond is retired from the country's debt.
- The money check that protects payouts still refuses real mismatches, it just no longer trips on tiny rounding differences in huge payments.
