---
date: 2026-10-03
title: Cash checks count each payment in the right turn
summary: Payments recorded outside a turn's own steps are checked against the turn whose balances include them.
tags: [accounting]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Count treasury, bond market and starting grant payments recorded between turns in the turn whose closing balances include them.
