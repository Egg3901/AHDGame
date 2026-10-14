---
date: 2026-10-14
title: "NPP engine 6: faster NPP stock buying"
summary: At autonomy v6, the NPP stock buy sweep settles each currency's purchases in parallel and reads equity pools once per sweep instead of once per purchase, with identical results.
tags: [npp, equities, performance, autonomy]
badges: [patch]
areas: [backend, engine]
---

## What changed

- At autonomy v6, the stock buy sweep is split by home currency. A purchase touches only its NPP, a corporation in the NPP's country and that currency's equity pool, so currencies share no document and run concurrently (up to 8 at once). Each currency draws from its own seeded stream, so the outcome does not depend on how many run together.
- If a corporation without a liquid currency could settle in a pool other than its partition's (possible under a seed preset), the partitions run one at a time.
- Equity pools are read once per sweep and passed to every purchase, removing one read per purchase. The settlement already keeps the pool snapshot's cash in step with its own credit.
- At v6 the stock and bond buy sweeps read their candidate corporations and bonds in one query each, instead of one per country.
- Tests settle real trades on an in-memory store: NPP debits equal pool plus issuer credits per currency, and the swept state equals a one-at-a-time replay that reads the pool per purchase.

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.

NPP engine version 6.16.1, recorded in the [NPP changelog](/changelog/npp).
