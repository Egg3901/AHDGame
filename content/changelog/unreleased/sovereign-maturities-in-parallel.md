---
date: 2026-10-08
title: Government bond maturities settle country by country in parallel
summary: >-
  When many government bonds mature on the same turn, each country's
  repayments now run alongside other countries' instead of one bond at a time.
tags: [turns, performance, bonds]
badges: [patch]
areas: [backend]
---

## What changed

- Every twelve turns a large set of government bonds matures at once. Their repayments used to be processed one bond at a time, which added about 20 seconds to those turns. Countries now repay their bonds in parallel, while each country still repays its own bonds in order and a holder of several countries' bonds is paid one bond at a time. Treasuries, funds and other holders end with the same balances as before.
