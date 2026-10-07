---
date: 2026-10-07
title: Actions no longer ask for more money than they cost
summary: >-
  In historical worlds, polls, campaigning, ads and donor building could be
  refused for lack of funds even though you had enough for the listed price.
  The funds check now uses the same era price you are shown and charged.
tags: [actions, campaigns, polls, economy, 1991]
badges: [patch]
areas: [fullstack]
---

## What changed

- The funds check for paid actions now uses the world's era prices. In a 1991 world it was checking against roughly 2.8 times the real cost, so a player who could afford the listed price was told they could not. The amount actually charged was always the listed price.
- The poll page now shows both poll prices in your campaign currency, at the same amount you are charged, instead of a dollar figure on the cards and a separately converted figure below them.
