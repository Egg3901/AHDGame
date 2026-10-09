---
date: 2026-10-09
title: Maturing government bonds settle cleanly
summary: >-
  Unsold units of a government bond that is due to mature are no longer sold
  on its maturity turn, so maturity payments settle in one pass.
tags: [bonds, turns, reliability]
badges: [patch]
areas: [backend]
---

## What changed

- A government bond reaching maturity no longer has its remaining unsold units sold to buyers on the same turn it is repaid.

## Developer detail

The primary market skips bonds with maturityTurn at or below the current turn, keeping due inventory stable for funded maturity snapshots while future bonds remain eligible. Includes a sovereign-primary integration regression. References: #3678, commit 9683d6140d.
