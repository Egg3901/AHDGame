---
date: 2026-09-06
title: Projected seats and resolved seats now run the same apportionment code
summary: >-
  The seats a player was shown before an election and the seats the race
  actually resolved to were computed by two separate implementations of the
  same rule. They had already drifted twice. There is now one.
tags: [elections, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- `largestRemainderSeats` in `seatAllocation.ts` is now the single
  implementation of party-pooled minimum-share eligibility, the degenerate
  ranked-order fallback, the optional majoritarian winner's bonus, and
  Largest-Remainder assignment.
- `allocateSeats` (which resolves a race) and `computeSeatEstimates` (which
  builds the projected-seats panel) both call it. Each keeps only its own
  surrounding concerns: the resolver keeps the bloc-list path, the 2-seat House
  rule, the over-allocation cap and the single-seat path; the projection keeps
  its multi-seat gate and null returns.
- No numbers change. This is the same rule with one definition instead of two
  hand-mirrored copies, so it is not a balance change.

## Why

The two engines have to agree exactly, or players see one seat total on the
election page and a different one on election night. They had already diverged
twice on ticket #1032: the projection gated per candidate where resolution
pooled by party, and its fallback re-admitted every candidate in roughly 11 of
12 Commons regions, so the panel applied no threshold at all and displayed
seats for parties that resolution zeroed. Both were repaired by re-coding the
copy, which left the same drift available on the next change to the rule.

## Added

- Direct coverage of the shared core: seat conservation, party pooling,
  independents standing alone, no re-admission of sub-threshold candidates,
  the fallback firing only when nobody clears the gate, and zero-vote pools.
