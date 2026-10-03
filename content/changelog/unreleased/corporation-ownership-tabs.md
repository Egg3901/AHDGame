---
date: 2026-10-03
title: Corporation Ownership tabs as tables
summary: >-
  The Shares, Deals and Structure tabs use the same table layout as the rest of
  the corporation page, and figures across the page are set in Geist Mono.
tags: [corporations, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Shares: the shareholder register is a table with each holder's kind, shares, ownership and CEO votes, and the Vote CEO action in the row. The price block and pie charts are gone; the page header already shows the quote.
- The order book shows bids and asks as two tables. You fill an order or cancel your own from its row.
- Open shareholder votes show the yes, no and abstained counts against the pass mark on one line, with Vote yes and Vote no buttons.
- Your holdings, stock split, private sale and share history use the same layout.
- Deals: incoming and outgoing acquisition offers are tables with Accept, Reject and Withdraw in the row. The index committee and sponsored fund forms follow the same style.
- Figures in tables and statistic rows are set in Geist Mono.
