---
date: 2026-10-04
title: Input-indexed industrial prices
summary: Industrial sectors can choose cost-plus pricing when explicit plant costs are enabled.
tags: [corporations, economy, pricing]
badges: [minor]
areas: [engine, frontend]
---

- Added a cost-plus choice for manufacturing, automobile, chemical and defense sectors.
- Indexed offers pass through input price changes on the recipe's input share, with a bounded price adjustment.
- Offers still compete on price and can remain unsold. Output scarcity does not multiply the indexed offer again, and brand loyalty sees the actual price used.
