---
date: 2026-10-07
title: Show actual bond holdings in fund details
summary: >-
  Fund pages now show their corporate and sovereign bond positions, including
  units, issuer and market value. Bond assets and open buy-order escrow appear
  in the balance sheet using actual holdings instead of estimates from NAV.
tags: [funds, bonds]
badges: [patch]
areas: [fullstack]
---

## What changed

- Added a bond holdings table to fund detail pages.
- Included actual bond market values and open buy-order escrow in fund assets.
- Kept equity holdings visible for funds with a mixed portfolio.
