---
date: 2026-10-16
title: Currency pegs use reserve-funded defence
summary: Declared peg targets now guide central-bank intervention and appear consistently before the next turn.
tags: [currency, central-bank, forex]
badges: [patch]
areas: [fullstack, engine]
---

- Declared currency pegs now defend their target using available reserves through the existing intervention rules.
- Peg defence stays committed when reserves run out. Change the commitment in Currency regime; independent band controls cannot override it.
- Moving from a peg to a band clears point defence. Set the new corridor through the intervention band controls.
- Funded intervention respects the current currency guardrails and applies only one hourly rate movement.
