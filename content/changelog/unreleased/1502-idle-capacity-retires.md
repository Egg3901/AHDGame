---
date: 2026-10-12
title: Plants that cannot sell their output now shrink over time
summary: >-
  A plant that keeps making far more than its market buys no longer pays
  wages and running costs on the unsold capacity forever. After a few turns
  of oversupply, the extra capacity retires a little each turn until the
  plant is close to what it sells.
tags: [economy, corporations]
badges: [patch]
areas: [engine]
---

## What changed

- When a plant has been held back by weak demand for more than six turns in a row, a small share of the capacity buyers are not taking retires each turn. The plant keeps a quarter more capacity than it sells, so it can grow back as demand returns.
- Capacity you park or mothball is never retired, and neither is capacity held back by missing inputs or staff.
- The plant page shows when retirement is coming and how much retired last turn.
