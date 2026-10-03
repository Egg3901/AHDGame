---
date: 2026-10-03
title: Position editor links encode their parts
summary: >-
  The admin position editor builds its state link and preset request from
  encoded values.
tags: [admin, security]
badges: [patch]
areas: [frontend]
---

## What changed

- The "Edit state demographics" link and the preset request in the admin position editor encode the country, state and era they carry instead of using the picker values as they are.
