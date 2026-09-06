---
date: 2026-09-04
title: "Coalition weakness means a group you are losing"
summary: >-
  The card ranked demographic groups by how much of your own support they
  make up, so it led with small groups you were winning and buried large
  ones you were being beaten in. It now ranks by your share of each group
  against the rest of the field, which is the question the card was always
  meant to answer.
tags: [campaigns, elections, demographics]
badges: [patch]
areas: [fullstack]
era: "Beta 2"
---

Cut from development.

### Changed

- Coalition weakness ranked each demographic group by the share of your own
  appeal it contributed. That measure is normalised to you, so a small group
  sat near the top of the list however completely you were winning it, and a
  large group you were losing sat near the bottom. The card now ranks by how
  much of each group you hold against everyone else in the race, and the
  percentage shown is that share.
- A group nobody is contesting reads as fully held rather than as an error.
