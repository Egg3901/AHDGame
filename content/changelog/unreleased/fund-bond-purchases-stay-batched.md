---
date: 2026-10-07
title: Index fund bond purchases settle together again
summary: >-
  Index funds no longer fall back to buying government bonds one at a time when
  a bond they planned to buy is close to maturity.
tags: [turns, performance, index-funds, bonds]
badges: [patch]
areas: [backend]
---

## What changed

- When an index fund's bond shopping list included a government bond that was being paid out at maturity, the whole batch of purchases was abandoned and redone one by one. Those bonds are now skipped while planning, so each fund's purchases are saved together and the turn spends less time on them. Funds buy the same bonds as before.
