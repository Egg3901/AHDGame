---
date: 2026-10-03
title: Bank console as tables
summary: >-
  The corporation Bank tab uses the same plain sections, figures and tables as
  the rest of the corporation page.
tags: [banking, corporations, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- The bank's health, run risk, next-turn outlook and position are figures under plain section headings, each saying whether it is something you set ("CEO control") or something to watch ("Monitor").
- Last turn earnings, your limits, the loan book, lending stance, player loans, interbank loans and the bank's own investments are tables. The lending stance table compares the three stances side by side; pick one by clicking its name.
- Loan approval is a two-way toggle. Rates show both offset sliders side by side, and the refusal list is three columns of names with Remove beside each.
- The console's own tabs use the same small tab style as the page's sub-tabs.
- The deposit and loan buttons for customers, which could render blank, now show their labels.
