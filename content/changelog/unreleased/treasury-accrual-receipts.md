---
date: 2026-09-30
title: Treasury accrual survives interrupted turns
summary: Fiscal cash movements now retain their accounting receipts and cannot repeat when a turn retries.
tags: [economy, treasury]
badges: [patch]
areas: [engine]
---

Treasury accrual now records revenue, spending, debt service and enforcement costs alongside its cash update. Interrupted or concurrent turn retries recover the receipt without charging or crediting the treasury twice. Tax-base and bond-service statistics remain available without being counted as additional treasury cash movements.
