---
date: 2026-09-30
title: Correct regional seed diagnostic coverage
summary: >-
  Seed diagnostics now check regional identities, exclude valid national summaries,
  and recognize supported legacy US turnout records without hiding real coverage gaps.
tags: [seed, diagnostics, reliability]
badges: [patch]
areas: [backend, engine]
---

## What changed

- National summaries no longer inflate regional metric counts.
- Missing, orphan and duplicate region identities are named even when total row counts match.
- Countryless legacy US turnout rows are recognized only for canonical state keys and DC. Explicit foreign country tags retain their scope.
