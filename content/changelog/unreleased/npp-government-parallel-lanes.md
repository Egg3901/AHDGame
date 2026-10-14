---
date: 2026-10-14
title: NPP governments plan their domestic turn in parallel
summary: At autonomy v6, the NPP governing phase runs each country's domestic steps in parallel lanes and keeps foreign policy in country order, cutting phase time without changing any decision.
tags: [npp, autonomy, performance]
badges: [patch]
areas: [backend, engine]
---

## What changed

- At autonomy v6, the NPP governing phase runs executive formation, the agenda, cabinet formation and ministers for up to four countries at once. Each of those steps only reads and writes the country's own records.
- Foreign policy still runs one country at a time in the same order as before, after every country's domestic steps. One government's tariff bill, embargo, vote or war order can shape the next government's choice, so that order is kept.
- If a country fails, no new country starts, foreign policy runs for the countries ordered before it, and the error is reported as before.

## Scope

Below v6 the phase runs one country at a time, exactly as before. At v6 decisions are unchanged except the order of the UK caretaker-resignation draws, whose odds are the same. NPP engine version 6.14.2.
