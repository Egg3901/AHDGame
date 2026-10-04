---
date: 2026-10-04
title: Quote investment-bank forex fees before trading
summary: Forex prop trades can charge the same size and liquidity curve as personal trades.
tags: [banking, forex, investing]
badges: [minor]
areas: [fullstack, engine]
---

- When enabled, investment-bank forex trades quote a fee based on the bank's recent volume and market liquidity. Purchases show the total cash cost; sales show net proceeds.
- Quoted fees settle once through guarded cash receipts. Currency caps and leverage still use the position's current value, excluding fees.
