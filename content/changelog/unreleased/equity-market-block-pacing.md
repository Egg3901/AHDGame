---
date: 2026-10-13
title: Very large share sales and issues now fill over several turns
summary: >-
  The stock market still pays the full market price, but it now buys at most
  5% of a company's value from sellers each turn, and places at most 10% of a
  company's shares from a new issue each turn. Small trades are unaffected.
tags: [economy, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- Selling shares to the market: the market buys up to 5% of a company's value each turn, counting every seller together. Sales worth less than ₳25M per company per turn are never limited.
- A market sell above that limit is refused with the amount you can sell now. A sell order above the limit stays open and fills a slice each turn at the market price.
- Issuing new shares: the market places up to 10% of a company's shares outstanding in one turn, or ₳50M worth, whichever is larger. The rest of an approved issue is placed over the following turns, the same way unplaced shares already were.
- Prices are unchanged. Nobody receives less for their shares, only later when a block is very large.
