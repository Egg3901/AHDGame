---
date: 2026-09-07
title: A country belongs to one alliance, and a bloc no longer sanctions its own
summary: >-
  Greece sat in NATO and the Warsaw Pact at the same time, and its foreign
  ministry spent two turns tabling Warsaw Pact sanctions against Russia and
  China. Joining one bloc now takes a country out of the other, founding a
  bloc no longer makes a member impossible to lose, and an organisation can no
  longer embargo a country on its own roll.
tags: [alliances, sanctions, diplomacy, blocs]
badges: [minor]
areas: [fullstack]
---

Cut from development.

## Fixed

- A country could hold a seat in NATO and the Warsaw Pact at once. Which bloc it
  actually counted as could then change from one reading to the next, so its own
  alliance was unreliable for every military and alignment question that asked.
  Joining one of the two now takes the country out of the other, and its
  departure is announced to the members it leaves behind.
- A founding member could never be shown the door, however far it drifted from
  the bloc it founded. That was the reason a country could accumulate a second
  alliance instead of leaving the first. Founders now answer to the same
  threshold as everyone else: fall to the leave share and stay there, and the
  bloc lets you go.
- The members' standing list told a bloc that a founder drifting out of it was
  safe, and hid the countdown that was in fact already running. Founders now
  show the same countdown as any other member, and sort with the members worth
  worrying about rather than below them.
- An organisation could vote through sanctions against one of its own members,
  which put every other member on an embargo against a country the same treaty
  obliged them to defend. Tabling those is now refused, and the target list on
  the sanctions form no longer offers your fellow members.
- An organisation that already had sanctions running against a country did not
  drop them when it voted that country in, leaving a member under its own bloc's
  embargo. Admission now lifts them.

## Changed

- A government that is steering its own country is still only warned when its
  alignment falls below the leave share, never moved out of a bloc without
  asking. That has not changed. What is new is that founding a bloc no longer
  exempts a country the game is running from the same rule.
