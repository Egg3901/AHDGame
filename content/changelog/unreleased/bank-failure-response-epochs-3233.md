---
date: 2026-10-04
title: Preserve bank failure response funding epochs
summary: >-
  Financial crisis rescues and guarantee claims remain tied to their original
  Treasury and bank charter snapshots across retries.
tags: [banking, crises, finance]
badges: [patch]
areas: [backend, engine]
---

Recapitalization, guarantees, and resolution now guard the active bank charter
epoch and native currency when publishing funded effects. Guarantee recovery
reuses its frozen pending quote, and claims cannot pay a later replacement
charter. Fiscal response credits also guard the original Treasury currency and
monetary authority. The global bank crisis decision is available to the head of
government, configured finance minister, and seated central bank chair.
