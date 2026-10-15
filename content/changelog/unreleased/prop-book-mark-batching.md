---
date: 2026-10-15
title: Faster prop book trades for banks
summary: Opening or closing a prop book position prices the whole book in a few batched reads instead of one read per holding.
tags: [banking, performance]
badges: [patch]
areas: [backend]
---

- Pricing a bank's prop book now loads every index fund, share price and bond it holds in one batch per market, instead of looking each holding up separately. Opening and closing positions on a large book is faster, and so is the end-of-turn bank solvency check. Marks and totals are unchanged.
