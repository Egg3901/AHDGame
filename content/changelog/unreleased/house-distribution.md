---
date: 2026-09-27
title: Make House representation fit state delegation size
summary: >-
  US House party eligibility now scales with each state's number of seats,
  reducing all-or-nothing results in large delegations while keeping a higher
  bar in small states.
tags: [elections, balance, us]
badges: [patch]
areas: [engine]
---

## What changed

- Kept the House party threshold at 20% in states with one to four seats.
- Gradually lowered the threshold for larger delegations, reaching 10% in
  states with nine or more seats.
- Kept the election page projection, hourly seat estimate, and final result on
  the same rule.
