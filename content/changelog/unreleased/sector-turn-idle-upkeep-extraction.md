---
date: 2026-09-06
title: Idle-capacity upkeep pulled out of the sector turn where it can be tested
summary: >-
  The rule that charges a plants sector for capacity it bought and is not
  using lived inside an 1,800-line function and could only be exercised by
  running a whole sector tick. It now has its own module and its own tests.
tags: [corporations, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- `computeIdleUpkeep` is its own module under `turn/corporation/sectorTurn/`,
  called by the sector turn instead of being inlined in it.
- No behaviour changes. It moved verbatim, and the flip turn is still an exact
  no-op so a world crossing onto plants sees no profit step.

## Added

- Tests for the two corrections the rule depends on and that were previously
  guarded only by a comment: the unit price is held at its anchor rather than
  tracking the live margin, so a distressed sector does not end up paying the
  most per idle unit; and the base is capacity the owner chose to leave idle,
  not capacity a disaster, a labour shortfall or an input shortage took away.
- Both were checked by breaking them on purpose and confirming the tests fail.
