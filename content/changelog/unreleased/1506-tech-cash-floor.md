---
date: 2026-10-12
title: Tech nodes have a minimum cash price
summary: >-
  Unlocking a tech node now always costs some cash, even for companies with
  little or no revenue.
tags: [corporations, tech-tree]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- A tech node's cash price is now the larger of 15% of the company's daily gross revenue or a minimum price. Before this, a company with no revenue paid only R&D points.
- The minimum is about 5 million in 2019 money and scales with the era, so it stays proportionate in earlier and later starting years. It is charged in the company's own currency.
- Large companies already pay more than the minimum, so their prices do not change. The same rule applies to AI-run companies.
