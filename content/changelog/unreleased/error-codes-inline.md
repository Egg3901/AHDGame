---
date: 2026-10-05
title: Error codes shown inline on failed actions
summary: >-
  Failed actions across the game now show the error code next to the message,
  with a reference id for server faults.
tags: [errors, ui]
badges: [patch]
areas: [frontend]
---

## What changed

- Action and form failures show the error code after the message, for example "Not enough cash (BAD_REQUEST)".
- Server faults also show a short reference you can quote when reporting a problem.
