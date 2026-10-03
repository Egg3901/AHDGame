---
date: 2026-10-03
title: Defaulted bonds no longer count as corporate income
summary: >-
  Corporations holding bonds in default were credited with coupon income that
  was never paid, and taxed on it. The tax came out of real cash, so a corp could
  show a profit while its capital fell every turn.
tags: [bonds, corporations, taxes]
badges: [patch]
areas: [backend]
---

## What changed

- A corporation's coupon income now counts only bonds that are paying. Bonds in default pay nothing and add nothing.
- Corporate tax on bond coupons is charged only on coupons actually received.
- Dividends, share price, and the income statement on the corporation page use the same corrected figure.
- The stock exchange listing no longer adds coupons from defaulted bonds to a corporation's income.
- Bonds a corporation has issued and defaulted on still count against it. The debt is still owed.
