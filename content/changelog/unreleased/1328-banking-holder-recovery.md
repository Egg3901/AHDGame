---
date: 2026-09-30
title: Explain failed savings holder requests
summary: >-
  Show a recovery message when a savings holder request cannot be delivered,
  and restore the selector for another attempt.
tags: [banking, bugfix]
badges: [patch]
areas: [web]
---

## What changed

- Savings holder network errors now show feedback instead of escaping as an unhandled rejection.
- Add browser qualification of banking commands, settlements, turn outcomes and monetary governance.
