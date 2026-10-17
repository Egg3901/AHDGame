---
date: 2026-10-17
title: Trade snapshots record where price-gap routing would change trade
summary: Each turn's trade snapshot now records surplus that could have reached a higher-priced shortage, and shipments that went to a cheaper market, to decide the next trade change on live evidence.
tags: [economy, trade]
badges: [patch]
areas: [engine]
---

- No gameplay change. The per-turn trade snapshot gains a measurement of stranded surplus and wrong-way shipments per good, used to judge whether trade between countries should be routed by price gaps.
