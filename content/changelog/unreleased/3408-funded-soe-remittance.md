---
date: 2026-10-07
title: State enterprise profit transfers no longer stop the corporation turn
summary: >-
  In worlds where the Treasury spends only cash it has actually raised, a state
  enterprise whose transfer is limited by its cash no longer asks for a fraction
  of a unit more than it holds, and a refused transfer no longer stops the turn.
tags: [turns, corporations, state-enterprises, treasury]
badges: [patch, hotfix]
areas: [backend]
---

## What changed

- A state enterprise that can only send part of its profit to the Treasury now sends whole units it actually holds. Before, its balance was rounded up, so the transfer asked for slightly more cash than it had, was refused, and stopped the corporation turn for every company.
- If a transfer is ever refused for lack of cash before any money moves, that enterprise simply sends nothing that turn, and other enterprises still pay. Retrying the turn keeps the original refusal and moves no money.
- A transfer that already took cash from the enterprise but has not yet reached the Treasury still stops the turn for recovery, so no money goes missing.
- Treasury balances, enterprise balances and earlier transfers are otherwise unchanged. The budget's estimate of enterprise transfers can drop by under one unit to match.
