---
date: 2026-10-01
title: Count NPC fund subscriptions once in accounting
summary: NPC fund subscriptions have one cash debit in reconciliation while investment income and fund receipts stay visible.
tags: [accounting, funds, npc]
badges: [patch]
areas: [engine]
---

## What changed

- Removed a duplicate accounting debit for NPC index-fund subscriptions.
- Preserved investment income, fund receipts, wallet balances, holdings and same-turn retry guards.
