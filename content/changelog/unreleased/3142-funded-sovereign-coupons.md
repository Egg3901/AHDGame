---
date: 2026-10-04
title: Funded sovereign coupon claims
summary: >-
  Public-float and non-bank sovereign coupon payments now require actual
  Treasury cash and retain frozen claims across shortfalls and retries.
tags: [economy, bonds, treasury]
badges: [patch]
areas: [backend, engine]
---

## What changed

- When funded Treasury cash is enabled, sovereign coupon claims are frozen by
  bond and due turn, then paid through a guarded settlement journal. Public
  float, character, corporation, index-fund, and NPP recipients cannot receive
  coupon cash unless the Treasury debit lands.
- Unfunded claims remain due and retry from their original holder and FX quote.
  The legacy coupon path remains active when the cash-ledger flag is disabled.
