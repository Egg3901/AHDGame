---
date: 2026-10-03
title: Corporation page and CEO Office redesign
summary: >-
  The corporation page and the CEO Office are now laid out as tables. The CEO
  Office is one screen: the budget is edited inside the income statement, and
  every sector's output, pricing and wages are set from its row.
tags: [corporations, interface]
badges: [minor]
areas: [fullstack]
---

## What changed

- The page header shows the name, listing, price, change, bid and ask, and the key figures in two lines, with a Trade shares button that opens the trade ticket. A CEO's uploaded banner shows as a plain strip on the Overview tab only.
- Overview is a key statistics table, a sortable table of every sector, your position, open shareholder votes, the largest shareholders and the corporate structure.
- The CEO Office is one page instead of sub-tabs. Budgets are typed into the income statement beside their share of revenue and what they buy per turn, with the change to operating income shown before you save.
- Every sector has one row in the Operations table with its output target, pricing and wage level. Changes save from the row. A bulk bar applies the same levers to a sector group or a whole country.
- Governance actions (shareholder address, ticker, legal form, headquarters, listing, supershares, caretaker, resign, dissolve) are rows that open their form in place.
- Fixed: the dividend estimate always said "/hour" whatever period was selected.
- Fixed: growth previews mixed a per-turn cost with a daily change.
- Fixed: capital injection did not refresh the treasury figure, and buyout prices for non-dollar corporations were shown in the wrong currency.
