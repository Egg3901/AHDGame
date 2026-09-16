---
date: 2026-09-16
title: Leadership chairs no longer sit empty after a party switch
summary: Changing party only costs the offices it actually disqualifies you from, and any seat it does empty opens an election straight away.
tags: [congress, leadership, elections]
badges: [patch]
areas: [backend]
---

## Fixed

- A party switch no longer empties leadership offices the switcher still qualifies for. The Speaker of the House is held by any sitting member, so changing party never costs the chair. A Minority Leader or Whip who moves to another non-majority party keeps their post.
- Every congressional seat a party switch does empty now opens a 24 turn election at once. The Speaker and both minority roles were previously vacated with no race, leaving the chair reading "Vacant" until an admin started one by hand.
- Banning an account now gives up its congressional leadership offices outright, including ones no party switch would touch.
