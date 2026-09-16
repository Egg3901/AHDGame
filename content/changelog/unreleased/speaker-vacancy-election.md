---
date: 2026-09-16
title: Leadership chairs no longer sit empty with no election
summary: Every congressional leadership seat that falls vacant now opens an election straight away, and losing your chamber seat is noticed on the turn it happens rather than whenever someone next opens the page.
tags: [congress, leadership, elections]
badges: [patch]
areas: [backend]
---

## Fixed

- A leadership chair emptied because its holder no longer sits in the chamber now opens an election to refill it. Previously the seat was vacated and nothing else happened, so the chair read "Vacant" indefinitely. This is what left the House with no Speaker after the 1970 general.
- That check now runs every turn instead of only on turns when a general election resolves, and no longer waits for somebody to open the congress page. A seat given up by a withdrawal, a resignation or a move to another chamber is picked up on the turn it happens.
- A party switch no longer empties leadership offices the switcher still qualifies for. The Speaker of the House is held by any sitting member, so changing party never costs the chair. A Minority Leader or Whip who moves to another non-majority party keeps their post.
- Every congressional seat a party switch does empty now opens a 24 turn election at once. The Speaker and both minority roles were previously vacated with no race, leaving the chair reading "Vacant" until an admin started one by hand.
- Banning an account now gives up its congressional leadership offices outright, including ones no party switch would touch.
