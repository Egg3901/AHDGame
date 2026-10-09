---
date: 2026-10-09
title: More casino games on the Discord bot
summary: >-
  The Discord bot now runs slots, roulette, crash, craps, high-low, animal
  races, a lottery and poker tables alongside blackjack, all paid in your
  character's home currency from one shared casino bank.
tags: [discord, casino]
badges: [minor]
areas: [backend]
---

## What changed

- Slots, roulette, crash, craps and high-low play against the casino bank. The server draws every result.
- Animal races, the lottery and poker tables pay out of a shared pot, less a small house cut.
- Blackjack wins now pay out in any home currency. Before, a win could fail in a currency the bank held none of.
- If the bank cannot cover a win, your stake comes back instead of being lost.
- Table limits scale with the bank: one stake can be up to 2% of it and one payout up to 10%.
