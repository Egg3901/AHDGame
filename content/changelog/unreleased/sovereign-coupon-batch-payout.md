---
date: 2026-10-07
title: Funded coupon payments settle in one step per country
summary: >-
  When a Treasury can pay its bond coupons that are owed to the open market, it
  now pays them together in one recorded payment per country and turn instead of
  one per bond.
tags: [turns, performance, bonds, treasury]
badges: [patch]
areas: [backend]
---

## What changed

- Coupons owed to the bond market pool that the Treasury can cover are paid together in one balanced payment per country each turn. Each coupon keeps its own frozen terms, the oldest unpaid coupons are still paid first, and anything cash cannot cover stays owed.
- Coupons held by players, corporations, funds or NPPs, and any coupon whose payment was already in progress, still settle one at a time on their own records.
