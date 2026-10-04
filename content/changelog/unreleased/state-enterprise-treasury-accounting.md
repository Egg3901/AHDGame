---
date: 2026-10-03
title: Treasury accounting includes state enterprise transfers
summary: Cash checks now include profit remittances, loss backing, capital grants and treasury draws between governments and their state enterprises.
tags: [accounting, nationalization]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Record state enterprise profit remittances on both the enterprise and the treasury.
- Record treasury loss backing and capital grants for state enterprises.
- Record chief executive treasury draws on both accounts.
- Share accounting reads and batch publication across the corporation turn.
