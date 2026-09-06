---
date: 2026-09-06
title: '"Bring both sides to the table" now actually opens mediation'
summary: >-
  During a scripted nationwide strike there is usually no player or NPP wage
  dispute in the struck industry, and the crisis option that brokers one
  required a pre-existing dispute to mediate. The most diplomatic presidential
  path silently did nothing while still paying out its approval effect.
tags: [crises, unions]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Fixed

- When the struck sector has no dispute to broker, the crisis now opens one
  against the industry's largest eligible employer instead of logging and
  returning. It is a real campaign built from live conditions by the same code
  path the union and NPP surfaces use, so the mandate comes from actual locals,
  treasury, labour tightness and collective-bargaining law. Both sides table a
  genuine wage package, so the mediator has a gap to close.
- Government conciliation opened from a national crisis waives the two-turn
  cooling-off delay, and only that. The delay exists so a party cannot table an
  offer and instantly demand a mediator; it was never meant to describe a
  government intervening in a nationwide strike. Every other precondition still
  applies: the dispute must be real, unmediated, legally permitted, and carry an
  offer from both sides.
- Employers already tied up in an open campaign are skipped, so this cannot
  collide with a live player or NPP negotiation.

## Added

- Tests for the waiver's scope, pinning that it relaxes timing alone and still
  refuses a non-dispute, an already-mediated campaign, a country whose law
  forbids mediation, and a dispute with only one side's package.
