---
date: 2026-09-06
title: Cabinet residuals saturate smoothly instead of pinning at the cap
summary: >-
  Cabinet-driven political residuals used a hard per-source clamp, so any
  channel at or above 0.8 points per turn sat at exactly 8.0 and extra
  investment bought nothing. Pinned regions then rendered identical values.
  The fold now approaches the same cap of 8 asymptotically, so a bigger push
  always buys a strictly bigger residual.
tags: [cabinet, political-metrics, balance]
badges: [patch]
areas: [backend, engine]
era: "Beta 2"
---

Fixes #703.

## Changed

- `foldCabinetResiduals` accumulates decay and contribution in an unbounded
  latent value and maps it through a smooth saturating curve with asymptote 8.
  Steady states now read roughly 3.7 for 0.4/turn, 6.1 for 0.8/turn, 6.4 for
  0.9/turn, 7.6 for 1.8/turn, and 7.9 for 3.6/turn, where the old clamp gave
  4.0 and then 8.0 four times over.
- Regions that were hard-pinned at 8.0 ease onto the new curve over a few
  turns instead of dropping: a standing contribution still holds them near the
  cap, and the first turn after this change moves them by about 0.01.
- Small residuals behave as before, and the decay factor stays 0.9.

## Added

- Regression coverage for the new curve: strict monotonicity across the full
  range, the asymptote under enormous contributions, distinct residuals for
  two different large pushes, and symmetric handling of negative pushes.
