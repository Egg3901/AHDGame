---
date: 2026-09-06
title: Auto-reelection entry stops querying per eligible character
summary: >-
  The auto-reelection turn phase issued roughly three awaited database round
  trips for every eligible character in every open race, plus an insert each.
  A nationwide election cycle put that into the hundreds of serial round trips
  inside the turn budget. It now resolves everything up front.
tags: [elections, performance]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- `runAutoReelectionEntry` no longer looks anything up inside its nested loop.
  Whether a character is already entered is answered from the candidacy set the
  phase had already loaded, so that check now costs no queries at all. Whether
  a character is blocked by another open race costs one status query for the
  whole run instead of two per character.
- Entries are written with a single unordered `insertMany` per election rather
  than one insert at a time, keeping the duplicate-key tolerance.
- Behaviour is preserved, including the subtle part: the old code inserted
  sequentially, so a second election sharing a seat key saw the first entry and
  skipped it. Entries are now recorded in memory at the moment the decision is
  made, so that still holds.
- The per-character entry log became one line per election listing the names,
  which is the same information with less turn-log noise.

## Added

- Coverage for the paths that moved into memory: already-entered, blocked by
  another open race, not blocked by a resolved race, two open elections sharing
  one seat, and an assertion that no per-character lookup is issued.
