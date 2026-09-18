---
date: 2026-09-18
title: Stronger stock valuations for profitable corporations
summary: >-
  Share prices now track operating performance more closely: earnings carry
  more weight in the price, expanding corporations earn a growth premium from
  actual enterprise-value growth, and sector asking prices sit nearer fair value.
tags: [corporations, economy, stocks]
badges: [minor]
areas: [backend, engine]
---

## What changed

- Raised the earnings-power weight in the share-price formula from 0.4 to 0.5 and the growth-premium weight from 0.1 to 0.15, so profitable corps price on performance rather than liquidation book alone.
- Under plants mode, the growth premium is estimated from trailing sector-NPV growth instead of paying for the retired growth slider or nothing at all. Flat, shrinking, or newly listed corps still get no premium.
- Trimmed the top share-price risk premia (financial, energy, extraction) from 7 to 6 points. Loan and coupon pricing are untouched.
- Raised sector asking prices from 75% to 85% of NPV. Payouts, salvage, borrowing capacity, taxes, and upkeep are unchanged.

## Why it matters

Corporations could post healthy operating numbers while their stocks barely moved: the formula priced them at book, paid zero for growth, and discounted every quote. These are valuation-only changes. No cash flow, cost, or demand rule moved, so existing operations earn exactly what they earned before.
