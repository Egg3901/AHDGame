---
date: 2026-10-08
title: The Market, one page for everything you can buy
summary: >-
  The Stock Market page is now The Market. A collapsible stock market chart
  sits on top, with stocks, bonds, funds, sectors for sale, commodities, supply
  deals and currencies in tabs below.
tags: [economy, ui]
badges: [minor]
areas: [fullstack]
---

## What changed

- New `/market` page with the stock market chart at the top. Collapse it and
  the choice is remembered.
- Tabs for Overview, Stocks, Bonds, Funds, Sectors for sale, Commodities,
  Supply deals and Currencies. Each tab loads only when you open it.
- Supply deals lists open offers across every commodity with logos, CEO
  pictures, volume per turn, estimated value per turn and a colored price chip.
  Filter by Players, NPPs or All (Players by default), Offering or Seeking,
  commodity, and sort by volume, price or newest. NPP offers are labeled.
- The nav item is now "The Market". Old `/stockmarket/global` links go to the
  matching tab. Country exchange pages are unchanged.
