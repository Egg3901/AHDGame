---
date: 2026-10-08
title: Treasuries and government bond repayments settle country by country in parallel
summary: >-
  Each turn's treasury update and the large government bond repayments every
  twelve turns now run for several countries at once instead of one at a time.
tags: [turns, performance, bonds]
badges: [patch]
areas: [backend]
---

## What changed

- Every turn, each country's treasury collects its share of revenue and pays interest to its bondholders. Countries used to do this one after another. They now run alongside each other, which takes several seconds off every turn.
- Every twelve turns a large set of government bonds matures at once. Their repayments used to run one bond at a time, which added about 20 seconds to those turns. Countries now repay their bonds in parallel.
- A country still settles its own payments in order, and a fund or player holding several countries' bonds is paid by one country at a time. Treasuries, funds and other holders end with the same balances as before.
