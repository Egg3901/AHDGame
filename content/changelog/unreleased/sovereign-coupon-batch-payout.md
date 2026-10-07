---
date: 2026-10-07
title: Funded coupon payments settle in one step per country
summary: >-
  When a Treasury can pay its bond coupons, it now pays them together in one
  recorded payment per country and turn instead of one per bond and turn, so a
  backlog of owed coupons no longer stalls the turn.
tags: [turns, performance, bonds, treasury]
badges: [patch]
areas: [backend]
---

## What changed

- Coupons the Treasury can cover that are owed to the bond market pool, index funds, NPPs or players are paid together in one balanced payment per country each turn. Each payee receives the sum of its coupons, each coupon keeps its own frozen terms, the oldest unpaid coupons are still paid first, and anything cash cannot cover stays owed.
- One payment holds at most 2,000 coupons. A larger backlog is paid down over the following turns.
- Coupons held by corporations, and any coupon whose payment was already in progress, still settle one at a time on their own records.
