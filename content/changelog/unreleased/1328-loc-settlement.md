---
date: 2026-09-30
title: Recover interrupted line-of-credit payments
summary: Preserve the original borrowing and repayment command across interrupted delivery.
tags: [banking, bugfix]
badges: [patch]
areas: [fullstack]
---

- Borrowing and repayment keep a command receipt, preventing an uncertain delivery from charging or borrowing again on retry.
- Turn servicing retains its original interest and payment quote. Savings that cannot be withdrawn no longer cancel debt.
- Income garnishment settles debt and residual wallet income together, with recoverable interest revenue, ledger records and residual currency conversion.
