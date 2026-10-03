---
date: 2026-10-04
title: Cash checks count player payments in the right turn
summary: Payments players make between turns are checked against the turn whose balances include them.
tags: [accounting]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Check cash moved by player actions, such as transfers, fund trades, credit lines and central bank operations, against the turn whose closing balances include it.
