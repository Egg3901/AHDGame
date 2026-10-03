---
date: 2026-10-03
title: New corporations start with the same value in every country
summary: A new corporation's starting treasury is converted at its currency's current exchange rate.
tags: [corporations, currency, economy]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Convert each new corporation's starting treasury at the current exchange rate for its currency, so it is worth the same in every country of an era.
- Corporations already in play keep their current funds.
