---
date: 2026-09-08
title: Union, banking and monetary policy correctness fixes
summary: >-
  Union votes stay tied to the offered terms, bank loans and repayments respect
  current balances, and central-bank policy uses the correct authority and reserves.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [unions, banking, monetary-policy, inflation]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Ratification votes close when bargaining terms change. Union service effects and contribution previews reflect operating eligibility and funding.
- Approved loans start their repayment term when funded and recheck affordability. Repayments and bank withdrawals remain consistent after interrupted turns.
- Central-bank liquidity reaches bank reserves. Shared-bank policy controls respect the issuing country's restrictions.
- Money-supply snapshots count player savings once. Inflation ignores unavailable or disabled money-growth signals and continues for countries without central banks.
