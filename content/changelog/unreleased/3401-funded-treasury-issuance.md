---
date: 2026-10-07
title: Quarterly bond auctions no longer stop the turn in funded Treasury worlds
summary: >-
  In worlds where the Treasury spends only cash it has actually raised, a
  quarterly bond auction the market could not fully buy no longer stops the
  turn. The unsold part stays on offer instead of being bought with new money.
tags: [turns, bonds, treasury, central-bank]
badges: [patch]
areas: [backend]
---

## What changed

- When the Treasury runs on funded cash, an autonomous central bank no longer tries to buy the part of a quarterly auction the market would not take. That purchase was forbidden in this mode, and the conflict stopped the turn.
- The unsold units stay on offer and sell over later turns as the market finds cash. Only units that actually sell add to the national debt and its coupon bill.
- Existing bonds, their holders, debt already owed, and player balances are unchanged. Worlds without funded Treasury cash keep the previous central-bank behaviour.
