---
date: 2026-10-10
title: Line of credit uses the lending pool of the bank you borrow from
summary: >-
  Borrowing from a foreign central bank is now checked against that bank's
  lending pool instead of your home bank's, and the pool is shown in that
  bank's currency.
tags: [banking, line-of-credit]
badges: [patch]
areas: [backend, frontend]
---

## What changed

- A draw from a foreign central bank no longer fails because your home bank's pool is used up.
- The System pool figure on a bank's Line of credit tab shows that bank's own pool in its own currency.
- Your personal credit limit is still shared across every bank.
