---
date: 2026-10-15
title: Faster Treasury coupon payments
summary: Treasury coupon payments now batch eligible payees across successive groups of holder types, reducing database work during the turn.
tags: [banking, treasury]
badges: [patch]
areas: [engine]
---

- Treasury coupon payments use fewer database calls when paying several types of holder, while preserving payment amounts and recovery after interruptions.
