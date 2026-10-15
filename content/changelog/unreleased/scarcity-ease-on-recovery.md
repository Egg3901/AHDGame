---
date: 2026-10-15
title: Commodity prices come down faster once a shortage starts to ease
summary: When a shortage is shrinking, its scarcity premium now unwinds about four times faster than before.
tags: [economy, commodities, prices]
badges: [patch]
areas: [engine]
---

- A commodity whose shortage is shrinking used to shed its scarcity premium more slowly than one whose shortage was not changing at all, so recovering markets stayed expensive for many extra turns.
- Recovering markets now unwind their premium by 4% of the excess each turn, halving it in about 17 turns. Markets where the shortage is getting worse still rise as before, and unchanged markets keep their current slow decay.
