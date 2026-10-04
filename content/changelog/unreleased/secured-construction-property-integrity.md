---
date: 2026-10-04
title: Protect secured construction property
summary: >-
  Corporation lifecycle operations preserve construction collateral and escrow
  until the secured obligation is resolved.
tags: [banking, construction, corporations]
badges: [patch]
areas: [backend, engine]
---

Sector abandonment, dissolution, transfers, takeovers, nationalization, duplicate
repair, corporation currency changes, and NPP divestment now refuse or skip
secured construction property. Multi-step operations mark property before
changing ownership or denomination, and only the owning operation may release
its transition marker after completion.
