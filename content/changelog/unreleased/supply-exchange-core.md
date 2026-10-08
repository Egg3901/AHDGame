---
date: 2026-10-08
title: Supply Exchange, take offers and safer contracts
summary: >-
  Posted supply offers are now standing offers you can take in one step, with
  an offers view on every commodity, amendable pending offers, and new guards
  against related-party and embargoed contracts.
tags: [corporations, commodities, supply-agreements]
badges: [minor]
areas: [fullstack]
---

## What changed

- Open supply offers are binding. Take one for any quantity up to what is left and an active agreement starts at the listed terms. The publisher and the taker are both notified.
- Each commodity has a Supply offers page listing sell offers and buy requests with quantity, price, term, the seller's country and credit rating. It is linked from the commodity page and the commodity market table.
- A sector's inputs panel now points to the offers for its costliest input when other corporations are selling it.
- You can amend your own pending offer instead of cancelling and proposing again.
- Corporations with the same owner, the same CEO, or a 5% shareholding in each other can no longer contract with each other.
- Supply agreements between countries whose trade lane is closed by an embargo or the iron curtain are blocked.
- Proposing, countering, amending, accepting and taking now respect the supply agreements setting and the corporation actions pause, and are rate limited.
- You are notified when a supply agreement is accepted, taken, cancelled or expires.
- Fixed a bug where buying a listed sector into a lane you already operate lost the seller's stockpiled inventory.
