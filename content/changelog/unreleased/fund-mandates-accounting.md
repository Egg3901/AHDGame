---
date: 2026-10-12
title: Sponsored funds select investments and account for seed money
summary: >-
  Sponsored index funds now select companies from their published scope.
  Management fees count each asset once, and new sponsors receive units for
  the money they invest.
tags: [investment-funds, corporations]
badges: [patch]
areas: [engine]
---

## What changed

- Sponsored broad and sector funds now select investments using their stored country and industry policy.
- Management fees count cash, shares, bonds and money held in buy orders once. A retry cannot charge the same turn twice.
- Seed money in newly created sponsored funds buys ordinary fund units. Those units share gains and losses with investors and stay invested while other investors or withdrawals remain.
- Existing funds keep their original seed terms, holdings and investor claims.
- Closing a fund waits for pending settlements and withdrawals before paying holders. Payouts and completion happen together so retries cannot pay twice.

Bank-managed picked-stock funds are a separate upcoming delivery.
