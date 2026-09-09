---
date: 2026-09-08
title: Party slates take up to three candidates per race
summary: >-
  A party may now assign up to three candidates to any one race, players and NPPs
  sharing the same slots, and every race says how many are left.
tags: [slates, elections, parties, npps]
badges: [minor]
areas: [fullstack, engine]
---

## What changed

- A party may hold up to three candidates on a single race. Players and NPPs draw on the same three slots, so a chair choosing a player spends the slot a chair choosing an NPP would.
- Every race on the Slate tab now says how many candidates it takes and how many slots are still free, and repeats it in the assignment picker. Assigning stops being offered once a race is full.
- Assignments beyond the third are refused with a reason. A row the turn could not place is marked "Race Slate Full" rather than disappearing from the board.

## Fixed

- Slates no longer grew a slot each cycle. Assignments carried forward from a previous cycle stopped counting as the chair's own picks, so one new assignment always fit however many had already collected on the race. That is why a board could show three candidates filed while refusing a fourth as "Slot Already Filled".
- A chair's pick and a candidate the party's own recruiting picked now both stand while the race has room, and the primary decides between them. Previously the chair's pick withdrew the other even when there was space for both.
- Races left above the limit are brought back inside it, oldest claims kept: a sitting member first, then whoever has stood longest, then the earliest assignments. Races whose primary has already closed are left alone, and a player's own candidacy is never withdrawn.
