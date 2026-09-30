---
date: 2026-09-30
title: Report election turnover with comparable historical outcomes
summary: Checkpoint reports now separate seat changes, control flips, representative replacement and incumbent retention, with explicit denominators and missing historical evidence.
tags: [elections, worldsim, reporting]
badges: [patch]
areas: [engine]
---

## Added

- Per-family election turnover rates from finalized election records and archived candidate identities.
- Executed resolver coverage, player and NPP win-cycle rates, tied-control counts and explicit unknown history.
- A read-only sandbox report command that records source provenance without publishing candidate names or identifiers.
