---
date: 2026-10-03
title: Corporation Finance tabs as tables
summary: >-
  Financials, Credit and Bonds, Charts and Snapshot use the same table layout as
  the rest of the corporation page.
tags: [corporations, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Financials: the income statement, balance sheet, valuation, cash flow and spending split are tables. The summary band and the side rail are gone.
- Credit: the rating, its four components, coupons by maturity, balance sheet context, peers and the rating scale are tables and rows. The composite history chart and the what-if debt slider stay.
- Bonds: the CEO issue form shows the face value slider, maturity and Issue bonds on one line, with rating, coupon, caps and headroom beside it and the projected cost underneath once an amount is set. Outstanding bonds are a table with plain status text.
- Bond history is a table with one row per turn. Open a turn to see its events.
- Charts: a table lists every metric with its latest value and change. Pick a row to chart it. Market share works the same way, one row per commodity.
- Snapshot: pick a lookback or two turns in the section header. The compare table sits underneath.
- Empty cells read n/a instead of a dash.
