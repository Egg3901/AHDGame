---
date: 2026-10-14
title: NPP governments plan their domestic turn in parallel
summary: The NPP governing phase now runs each country's domestic steps in parallel lanes and keeps foreign policy in country order, cutting phase time without changing any decision.
tags: [npp, autonomy, performance]
badges: [patch]
areas: [backend, engine]
---

## What changed

- The NPP governing phase runs executive formation, the agenda, cabinet formation and ministers for up to four countries at once. Each of those steps only reads and writes the country's own records.
- Foreign policy still runs one country at a time in the same order as before, after every country's domestic steps. One government's tariff bill, embargo, vote or war order can shape the next government's choice, so that order is kept.
- If a country fails, no new country starts, foreign policy runs for the countries ordered before it, and the error is reported as before.

## Scope

Decisions are unchanged at every autonomy level. Only the phase's running time changes.
