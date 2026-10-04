---
date: 2026-10-04
title: Quote loan fees before borrowing
summary: New private-bank loans withhold a one percent origination fee from funded proceeds.
tags: [banking, loans]
badges: [minor]
areas: [fullstack, engine]
---

- Borrowers see the fee and net cash before requesting a loan. The contractual principal and repayments still use the full loan amount.
- A pending request retains its quoted fee; legacy requests remain fee-free. Approval retries cannot charge the fee twice.
- Newly funded household lending also withholds the fee. Repayments and existing loans do not incur another origination charge.
- Bank earnings show household origination fees separately from interest, with lifetime fees for the current charter.
