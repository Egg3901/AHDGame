---
date: 2026-10-03
title: Corporation Operations tabs as tables
summary: >-
  Sectors, Commodities, Tech, Contracts and Defence use the same table layout as
  the rest of the corporation page.
tags: [corporations, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Sectors: one row per sector, one line high. Click a column heading to sort; click it again to reverse. Strategy, status, fill, building capacity, mothballed and for-sale markers are plain text instead of badges.
- Pick a sector type from the select above the table to open that division: its briefing, its figures, its operating strategies and what each one consumes and produces, with one build button.
- Commodities: one table of every commodity this corporation makes or uses, with price, output, consumption, net production, their value, and the world stock and cover. Private supply shows as a line under the commodity it covers. A second table breaks output down by state.
- Supply agreements and open supply offers drop their nested boxes and badges.
- Tech: each decade lists the Corporate and Sector tracks as tables of technologies with their effects, cost and an Unlock button, grouped by root, branch and specialization. Research figures sit in a panel beside the explanation.
- Extraction contracts and defence orders are tables with Accept and Decline in the row.
- Empty cells read n/a instead of a dash.
