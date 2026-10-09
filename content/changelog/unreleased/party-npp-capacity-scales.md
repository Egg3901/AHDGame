---
date: 2026-10-09
title: Party NPP capacity scales with membership and country size
summary: >-
  The flat 25 NPP limit on parties is gone. Capacity grows with active members,
  tapering as a party gets larger, up to a ceiling set by the size of the country.
tags: [parties, npps, balance]
badges: [minor]
areas: [backend, frontend]
---

## What changed

- Parties get 5 NPP slots for each of their first 5 active members, 4 each for the next 5, 3 each up to 20 members, and 2 each after that.
- The party-wide ceiling is 3 NPPs per region in the country, and never less than 25. That is 153 in the United States, 72 in Russia, 48 in Germany and 36 in the United Kingdom.
- Small parties keep the same capacity as before.
