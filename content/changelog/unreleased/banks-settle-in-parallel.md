---
date: 2026-10-08
title: Banks settle their turn in parallel
summary: >-
  Each bank's turn (deposits, interest, insurance and loan payments) now runs
  alongside other banks instead of one bank after another.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- Banks used to settle their deposits, interest, insurance premiums and loan payments one bank at a time, which made the banking step one of the longest parts of every turn. Banks now settle in parallel. Two banks still take turns when they share a currency, a depositor or a borrower, so every account is updated in the same order as before. Banks, depositors and borrowers end with the same balances as before.
