---
date: 2026-10-09
title: The sector profit margin breakdown is now one calculation
summary: >-
  The margin breakdown on a sector page now adds up from sales revenue to net
  margin in one list, and the policy line shows what it is made of.
tags: [corporations, sectors, margins]
badges: [patch]
areas: [frontend]
---

## What changed

- The policy line is now called Policy, tax and support, and opens to show each condition behind it as a percent of sales revenue. The rows add up to the line.
- Crisis and disaster losses have their own line instead of sitting inside other operating costs.
- The list of state, corporate and national conditions is folded under Condition details and no longer shows a 35% starting margin or a commodity markets figure, neither of which moves money for a sector with plants.
- The inputs panel shows your input bill as a share of sales revenue in place of the old net effect of prices figure.
- State conditions are no longer counted twice inside the policy line breakdown.
