---
date: 2026-10-07
title: Leave party confirmation works in the desktop and mobile apps
summary: >-
  Leaving a party now asks for confirmation in an in-game dialog instead of the
  browser's pop-up, which the desktop and mobile apps could not show. Cancelling
  keeps your membership; confirming leaves the party once.
tags: [parties, native-client]
badges: [patch]
areas: [frontend]
---

## What changed

- The Leave party button on a party page opens an in-game confirmation dialog. The desktop and mobile apps blocked the old browser pop-up, so the confirmation failed with an error.
- Confirming sends one leave request even if the button is clicked twice. Cancelling sends nothing.
- The button and dialog text are translated.
