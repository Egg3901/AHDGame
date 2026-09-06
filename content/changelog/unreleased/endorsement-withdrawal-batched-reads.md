---
date: 2026-09-06
title: Endorsement withdrawal phases stop issuing one query per endorsement
summary: >-
  The two endorsement-withdrawal turn phases resolved their election, candidate
  and office holder one lookup at a time inside the loop, so a busy election
  cycle cost hundreds of serial round trips on the turn hot path. Reads are now
  batched up front.
tags: [elections, performance]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- `processExecutiveEndorsements` and `processGovernorEndorsements` preload
  their targets before iterating. Elections and candidates come from two `$in`
  queries against deduplicated id sets; the governor phase additionally
  resolves every sitting regional executive in one query, narrowed to the
  states its endorsements actually reference.
- Cost no longer scales with endorsement volume. Both phases previously ran
  two to three awaited round trips per active endorsement, and endorsements
  accumulate through an election cycle.
- Behaviour is unchanged. A missing row and a non-active status still collapse
  to the same withdrawal decision, and the governor check is still keyed on
  country, state and character together, so the right character in the wrong
  state does not keep an endorsement alive.

## Added

- Regression coverage for both phases, which previously had none: the three
  withdrawal reasons, the keep-alive path, missing-row handling, the
  wrong-state case, and an assertion that 200 endorsements still issue a fixed
  number of reads.
