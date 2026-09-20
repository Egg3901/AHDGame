---
date: 2026-09-20
title: Presidential election history is viewable again
summary: >-
  Past presidential races are reachable from the current race again, and each
  one now shows the result as it was decided rather than as today's map would
  score it.
tags: [elections, president, results]
badges: [minor]
areas: [fullstack]
---

Cut from development.

## Fixed

- Previous and Next buttons are back on every presidential screen. They went missing when the primary, general and results screens were rebuilt, which left finished races with no way in at all, because the elections list only shows races that are upcoming or under way.
- Opening a past race from those buttons now loads its full results board instead of dropping to the plain summary.

## Changed

- A finished presidential race is now stored as it was decided. Results used to be rebuilt on every visit from the present day's electoral map and the present day's party list, so an old race could show a vote total and a winning line that were never in force when it was run, and a party that had since been renamed or wound up would rewrite its own past.
- Every presidential race already on record has been captured, so history reads correctly from the moment this ships.
