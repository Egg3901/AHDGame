---
date: 2026-09-09
title: Legislatures and executives now match the era the world is set in
summary: >-
  The United States opened its 1991 and 2019 worlds with no president at all,
  and the seat maps disagreed with the chambers they were filling. Every
  legislature a player can lead now starts at its real size, with the real
  people's parties in it, and a reset no longer leaves the previous era's
  parties behind.
tags: [countries, presets, elections, seats, seeding]
badges: [minor]
areas: [backend, engine]
---

Cut from development.

## Fixed

- Worlds set in 1991 and 2019 now start with a President and Vice President in
  office. The presidency previously sat empty until the first scheduled
  election, which is about two days of play in a 1991 world and about ten in a
  2019 one.
- The House of Commons is complete. A 2019 world seated 641 of its 650 members,
  and the regions electing them added up to a different number again, which
  would have misallocated a general election.
- The 1992 Commons, the 1990 House of Representatives in Japan and the 1953
  Senate now start at the size they really were, rather than at their modern
  size. The 1953 Senate seats 96 for the 48 states of the day, and the 1992
  Commons 651.
- The United States House now matches the chamber it is modelling: the right
  members in the right states, with the five seats that stood empty at the time
  left empty rather than quietly filled or quietly missing.
- Iowa's delegation was the wrong way round, giving the Republicans two seats
  that belonged to the Democrats.
- Resetting a world to another era no longer leaves the previous era's parties
  behind. East German parties no longer survive into a world set after
  reunification, and Reform UK no longer turns up in a 1953 Britain.

## Known gaps

- Japan's House of Councillors is the right size for 1991 at last, but only 206
  of its 252 seats have members in them. The rest sit empty until the 1989
  results are written up region by region.

## Changed

- A chamber can now record seats that are deliberately empty, so a vacancy and a
  gap in the records are no longer the same thing.
