---
date: 2026-09-16
title: Country folders, proved on Japan
summary: >-
  Japan's data used to be written out across 120 different files. It now lives
  in one folder, and those files point at it instead of each holding a copy.
  Nothing about the game changes: the same Japan, the same numbers, the same
  pages. This is groundwork for giving every country the same treatment.
tags: [countries, japan, refactor, groundwork]
badges: [patch]
areas: [backend]
---

Cut from development.

## Changed

- Japan's data now lives in one place. Its name, institutions, elections,
  economy, geography and each era's overrides used to be written out across 120
  files. Those files still name Japan, but they now point at the country folder
  instead of each holding a copy of the answer.
- A country now has a written contract: the shape a country has to fill in for
  the game to know what it is. Japan is the first country to satisfy it, which
  is what proves the shape is usable before the other 23 follow.

## Notes

Nothing here is player visible. No number, rule, seat, price or piece of text
changed, and no save or world is affected. This is preparation: the same work
has to happen for the other 23 countries, and doing Japan first is what
establishes the pattern and finds the traps while only one country is at stake.
