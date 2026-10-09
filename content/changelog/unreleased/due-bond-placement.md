---
date: 2026-10-09
title: Protect government bond repayments at maturity
summary: "Government bonds that are due or overdue no longer receive new primary-market placements while repayments are being resolved."
tags: [bonds, reliability]
badges: [patch]
areas: [backend]
---

## What changed

Government bonds that are due or overdue no longer receive new primary-market placements while repayments are being resolved.

## Developer detail

The primary market skips bonds with maturityTurn at or below the current turn, keeping due inventory stable for funded maturity snapshots while future bonds remain eligible. Includes a sovereign-primary integration regression. References: #3678, commit 9683d6140d.
