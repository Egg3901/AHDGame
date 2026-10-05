---
date: 2026-09-21
title: Departments now show how funded laws are delivered
summary: >-
  Spending laws can now flow through persistent department accounts instead of
  acting as unconditional permanent bonuses. Funding, institutional capacity,
  regional responsibility, and Cabinet priorities determine how much a program
  actually delivers, with separate rollout controls for safe migration.
tags: [legislation, cabinet, budgets, regions, simulation]
badges: [major]
areas: [fullstack, engine]
---

## What changed

- US, UK, and Japan laws now carry explicit department, program, jurisdiction,
  and delivery metadata.
- Ordinary spending departments retain their own balances, commitments,
  arrears, capacity, and program history across changes of officeholder.
- Cabinet holders can divide same-priority department funding among active
  programs without overriding protected obligations.
- Regional laws remain enacted after a later revenue shortfall, while funding
  and delivered outcomes adjust to the budget actually available.
- National grants enter regional budgets from the responsible department
  account without charging the national treasury a second time.
- Proposal validation treats only authored legal regimes as conflicts. Policy
  labels alone do not make two laws incompatible.
- Department finance, law administration, and regional finance each have an
  independent admin rollout switch.

## Verification

- The isolated test-server simulation settled one program in each of the US,
  UK, and Japan and replayed the same turn without adding any financial flow.
- Deterministic simulations cover full funding, funding and capacity
  shortfalls, Cabinet allocation, regional revenue shocks, grants, turnover,
  repeal, and cross-label compatibility.
