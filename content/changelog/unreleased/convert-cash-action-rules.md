---
date: 2026-09-17
title: Shared Personal Donation rules
summary: Personal Campaign Donation conversion, infamy and quote share a portable rules module.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Personal Campaign Donation quotes, effects, the execute shell, the AI advisor and the UI previews use the same portable conversion, infamy and quote rules. Existing balance, the 50% rate, the infamy curve and the flat 2 AP cost are preserved.
- Personal Campaign Donation validation rejects a missing or non-positive amount with the quoted reason instead of pricing zero. Fixed advisor drift: whale previews now apply the 100 infamy cap the execution uses.
