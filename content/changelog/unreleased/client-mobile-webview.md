---
date: 2026-09-06
title: The mobile client keeps ads and consent prompts out of the app
summary: >-
  The A House Divided client on Android and iOS shows the game in an in-app
  view. Pages shown that way no longer carry ad slots, the ad consent prompt or
  the cookie banner, the same treatment the earlier Android app already had.
tags: [client, mobile, ads]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- The site recognises the mobile client's in-app view and leaves out ad slots,
  the ad consent prompt and the cookie banner there.
- Everything else, including the navigation bar and footer, stays as it is in
  a browser.

## Why it matters

Ads inside an app view are not allowed by the ad network, and consent prompts
sized for a browser get in the way on a phone. Players using the app see the
game the way it is meant to be seen there.
