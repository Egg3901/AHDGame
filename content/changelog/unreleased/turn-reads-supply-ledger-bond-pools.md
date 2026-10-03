---
date: 2026-10-03
title: Faster turns from leaner economy reads
summary: >-
  Several turn steps now read less from the database: NPP supply contracts,
  the economic vital signs report, the bond market pools, and NPP stock trades.
  Nothing about how the economy behaves changes.
tags: [performance, turns, economy]
badges: [patch]
areas: [backend]
---

## What changed

- The NPP supply-contract pass loads only the contract and sector fields it uses, about a quarter of what it read before.
- The economic vital signs report keeps a per-turn summary of ledger turnover instead of re-adding 48 turns of ledger entries every turn.
- The bond market pools gather their inputs for every currency at once before updating, instead of one read at a time.
- NPP stock purchases and sales read their market's pool once per trade instead of two or three times.
