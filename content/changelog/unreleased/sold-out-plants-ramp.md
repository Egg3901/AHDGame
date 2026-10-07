---
date: 2026-10-07
title: Plants that sell out ramp up faster in short markets
summary: >-
  A plant that sold everything it made into a market with buyers left unserved
  now steps up to meet that demand instead of climbing 15% a turn, and the
  sector page no longer calls it demand limited.
tags: [economy, corporations, plants]
badges: [patch]
areas: [fullstack]
---

## What changed

- When your plants sell every unit and the market they sell into still has more buyers than sellers, next turn's run grows to cover that unmet demand, up to full capacity. Before, output only rose about 15% a turn, so a plant could sit at a third of capacity for many turns while its market stayed short.
- Plants that sell into a balanced or oversupplied market keep the old behaviour: output follows what actually sold, plus a small step to test for more buyers.
- On the sector page, idle capacity on a plant that sold everything now shows as "Ramping up" instead of "Demand limited", so it no longer sits next to "100% sold" as if the two disagreed.
