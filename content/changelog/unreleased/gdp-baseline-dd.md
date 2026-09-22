---
date: 2026-09-19
title: East German and Soviet income restored
summary: >-
  East Germany and the Soviet Union were missing the national income benchmark
  the game needs to work out what a region earns. That broke East German
  profile pages, made signing in through Discord look broken, and stopped
  campaign income paying out for everyone on turns where it was hit.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, campaigns, east germany, soviet union, profile, turn processing]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [hotfix]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## Fixed

- Campaign income did not pay out on some turns, for every player rather than
  only the ones involved. Working out a region's earnings needs a national
  income benchmark, East Germany and the Soviet Union had none, and the income
  step gave up the moment it reached a politician from either. Both have one
  now, set from their own regional economies rather than borrowed from another
  country. Get out the vote and caucus dues were dropping out the same way and
  now run normally too.
- Opening your profile as an East German politician showed "Something went
  wrong" instead of your campaign income. It loads again.
- Signing in through Discord appeared to fail for those players. The sign in
  itself was always fine; it just handed you straight to the profile page that
  could not load. With the profile fixed, signing in works as expected.
