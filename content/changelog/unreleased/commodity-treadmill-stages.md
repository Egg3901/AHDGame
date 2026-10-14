---
date: 2026-10-14
title: Staged commodity market correction
summary: Six operator-advanced stages stop commodity prices climbing on a shortage that new capacity could never close.
tags: [economy, commodities, markets]
badges: [patch]
areas: [engine]
---

- Scarcity price memory now follows whether a shortage is getting worse or better, not how large a capped residual reads. A chronic but stable shortage keeps its honest market price and stops ratcheting up every turn.
- Retail demand grows with GDP at a third of the old rate and tops out at 30% above baseline instead of double.
- Household and government purchases are bounded at 1.25x last turn's supply instead of 1.5x, so building capacity actually narrows the gap.
- Plants running a positive production policy into a deep shortage of their own product get up to 10% more output and input draw.
- Surplus extractable stock above 96 turns of cover spoils faster, clearing the timber glut.
- Each stage switches on separately via an operator setting and reverts alone. Applied prices keep moving at most 6% per turn toward target.
