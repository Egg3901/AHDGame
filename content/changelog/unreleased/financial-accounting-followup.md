---
date: 2026-09-08
title: Consistent union services and monetary accounting
summary: >-
  Union services now remain active for the turn they were paid for. Money supply
  counts stored balances consistently, and monetary committees explain when a
  passed motion cannot take effect.
tags: [economy, unions, banking]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Union dues settlements buy services for the following turn. Paid services stay consistent across workplaces, approval and politics, and the union page distinguishes them from your next selection. Existing unions start this schedule with their next settlement.
- Money supply counts each stored balance once. Household income estimates appear separately, and lending reserves remain outside circulating money. Bond purchases and savings interest no longer create a second balance in the external pool.
- Reported M2 changes to the corrected measurement without changing existing account balances. Money growth becomes available after 12 turns measured under the same method; the transition itself does not drive inflation or monetary decisions.
- Market liquidity targets retain their calibration when the money-supply measurement changes, preventing the transition from draining market cash.
- Fundraising, political spending, starting wealth and founding costs now use the world's stored base currency rates. Historical worlds no longer apply modern rates to these flows, and market exchange-rate movements do not change their prices.
- New-world money baselines convert GDP into the currency's own units before applying the money-to-GDP ratio. Existing monetary balances are preserved. Central-bank intervention limits also use the world's stored base rate.
- Monetary committees recheck current exchange-rate commitments and rate-change limits before implementing a motion. A passed vote can show a blocked execution and its reason.
- Interrupted bank settlements remain eligible for automatic recovery until all related records are updated. Banking journals and monetary snapshots also load less data.
