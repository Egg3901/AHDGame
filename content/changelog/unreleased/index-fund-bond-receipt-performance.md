---
date: 2026-09-20
title: Reduce index fund turn database work
summary: Index funds persist completed bond purchase receipts together during reserve deployment.
tags: [performance, funds]
badges: [patch]
areas: [engine]
---

- Bond reserve purchases reuse their exchange-rate snapshot and persist receipts in one batch per fund.
- Cash checks, bond reservations, pool credits and purchase ordering remain unchanged.
- Completed purchase receipts are flushed even when a later purchase fails.
