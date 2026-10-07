---
date: 2026-10-07
title: Unpaid coupon arrears no longer slow the Treasury step
summary: >-
  Unpaid sovereign bond coupons are now kept as their own records instead of on
  each country's budget. The Treasury step of the turn stays the same size as
  arrears build up.
tags: [turns, performance, bonds, treasury]
badges: [patch]
areas: [backend]
---

## What changed

- A coupon a Treasury cannot yet pay is still owed on the same frozen terms and is still paid in order once cash arrives. It is now stored on its own instead of on the country's budget, so a country in arrears no longer makes every later turn heavier.
- Freezing a turn's coupons is one batched write per country instead of one write per bond.
- Paid coupon records are cleared once their payment is fully settled.
