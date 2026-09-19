---
date: 2026-09-18
title: Every country's data now lives in one folder
summary: >-
  Each country's name, institutions, elections, economy, geography and era
  overrides used to be written out across hundreds of separate files, with the
  same answer copied into many of them. Every country now has one folder that
  holds it once, and those files point at it. Nothing about the game changes:
  the same countries, the same numbers, the same pages.
tags: [countries, refactor, groundwork]
badges: [patch]
areas: [backend]
---

Cut from development.

## Changed

- All 29 playable countries now keep their data in one folder each. The files
  that used to hold a copy of a country's answer now point at that folder, so
  there is one place to read and one place to change.
- A country has a written contract: the shape a country has to fill in for the
  game to know what it is. Every country satisfies it, and the contract was
  corrected along the way, because several fields it demanded of everyone turned
  out to be things only the first six countries had.
- The checks that prove a country's folder and the rest of the game hold the
  same data, rather than two copies that happen to match, now run with the test
  suite instead of only by hand.

## Fixed

- Greece, Austria and Finland had region statistics that the seed audits could
  not see, so those three countries were quietly skipped.
- A country that does not exist in the era a world is set in, such as East
  Germany after reunification, was still being processed every turn even though
  every page correctly reported it as gone.

## Notes

No number, rule, seat, price or piece of text changed, and no existing world is
affected. The one behaviour change is the last item above: countries absent from
a world's era are now left out of turn processing, which is what the rest of the
game already assumed.
