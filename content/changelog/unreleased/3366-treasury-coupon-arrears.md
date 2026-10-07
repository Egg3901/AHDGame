---
date: 2026-10-07
title: Faster Treasury processing for unpaid bond coupons
summary: >-
  Treasury processing no longer slows down every turn while a government
  cannot afford its outstanding sovereign bond coupons.
tags: [treasury, bonds, turn]
badges: [hotfix]
areas: [backend]
---

## What changed

- Unpaid sovereign coupon payments that the Treasury cannot currently cover are now deferred without a failed payment attempt each turn. They stay owed and are paid in order once the Treasury has the cash, exactly as before.
- This removes a per-turn cost that grew with every turn of unpaid coupons and could push Treasury processing past its time limit.
