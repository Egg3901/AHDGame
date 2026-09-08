---
date: 2026-09-07
title: Faster page loads on the elections screen
summary: >-
  The UK elections page asked the server for a manifesto once per contested
  race, so a screen with a dozen races opened a dozen separate requests before
  the manifesto panels appeared. It now asks once for all of them. Every page on
  the site also stops fetching two analytics scripts that have never existed on
  our servers.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [performance, elections, manifestos]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## Fixed

- Opening the UK elections page fired one request per contested Commons race,
  each one repeating the same sign-in check and returning the same pledge list.
  Those requests were a fifth of all recorded traffic to the game's interface.
  The page now collects every manifesto in a single request, and the manifesto
  panels appear together instead of arriving one at a time.
- Manifesto records had no database index, so every read searched the whole
  collection. They are indexed now.

## Changed

- Every page used to request two analytics scripts from an address that does
  not exist on our servers. Each attempt returned a full error page that the
  browser then threw away, and neither script ever recorded anything. Both are
  gone, so every fresh page load makes two fewer round trips and downloads
  roughly 68KB less. Page view figures are unaffected: they come from the
  game's own tracking, which is untouched.
