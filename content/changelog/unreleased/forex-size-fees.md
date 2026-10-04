---
date: 2026-10-03
title: Big currency trades cost more, and trading moves rates less
summary: >-
  Your own currency trades now pay a size fee that grows with how much you
  convert, and fees depend on how busy each currency is. Trading volume now
  nudges exchange rates far less, and one trader alone can barely move a
  currency.
tags: [forex, currency, economy, central-banks, balance]
badges: [minor]
areas: [backend, frontend]
---

## What changed

- Market and limit trades you make yourself pay a size fee on top of the base fee. It rises toward 20% on very large conversions and counts everything you converted in the last 24 turns, so splitting a big trade into small ones costs the same.
- The whole fee is scaled by how busy the two currencies are: half price in a busy market, up to one and a half times in a quiet one. The total never passes 30%.
- Conversions the game makes for you (dividends, coupons, purchase shortfalls) pay only the base fee, as before.
- Fees go to central banks the same way the base fee does.
- Net buying and selling now moves an exchange rate far less. It takes about ₳1B of net volume to reach half of the old push, and the push counts for a quarter of what it did. About five traders need to be behind a flow for it to work at full strength; one trader alone gets a fifth.
- Central-bank intervention keeps its full strength, so a bank can lean against a large flow.
- The trade window shows the actual fee for your amount and explains the size and market fee. The forex and investing guides show the current fees.
