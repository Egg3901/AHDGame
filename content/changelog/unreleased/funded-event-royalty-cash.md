---
date: 2026-10-04
title: Settle national royalties and event costs from funded Treasury cash
summary: >-
  Enabled national extraction royalties and country event costs use durable
  Treasury cash receipts. Positive event deltas remain analytical until a
  funded source exists.
tags: [accounting, governments, corporations]
badges: [patch]
areas: [backend, engine]
---

## What changed

- National extraction royalties use one frozen exchange-rate quote and a
  replayable corporation-to-Treasury cash settlement. State-budget royalties
  retain their existing route; missing state budgets fall back to national
  Treasury cash.
- Negative country-event Treasury deltas use guarded spendable cash and durable
  receipts. Positive deltas update signed fiscal-position analytics without
  creating cash.
- Money-supply audit output reports central-bank FX revenue and spread reserves
  separately from M1 and M2.
