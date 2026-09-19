---
date: 2026-09-19
title: East German profiles load again
summary: >-
  Players in East Germany hit an error page instead of their profile, which
  also made signing in through Discord look broken, because that is the page
  sign-in drops you on. Their profile now loads normally.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, campaigns, east germany, profile]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## Fixed

- Opening your profile as an East German politician showed "Something went
  wrong" instead of your campaign income. Every nation needs a national income
  benchmark before the game can work out what a region earns, and East Germany
  was missing one, so the page gave up rather than guess. It has one now, set
  from East Germany's own regional economy rather than borrowed from another
  country.
- Signing in through Discord appeared to fail for the same players. The sign in
  itself was always fine; it just handed you straight to the profile page that
  could not load. With the profile fixed, signing in works as expected.
