---
date: 2026-09-30
title: Recoverable treasury reserve transfers
summary: >-
  Treasury reserve transfers conserve signed treasury and central-bank cash,
  retain their original command on retry, and leave annual appropriations intact.
tags: [banking, economy]
badges: [patch]
areas: [engine, web]
---

## What changed

- A treasury transfer moves cash once and records recoverable accounting and audit receipts.
- Interrupted delivery resumes the original transfer, including its history and actor context.
- The cabinet form explains the one-time cash transfer and keeps its command identity after ambiguous network errors.
