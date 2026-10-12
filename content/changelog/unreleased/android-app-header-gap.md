---
date: 2026-10-12
title: Android app header no longer has an extra gap at the top
summary: >-
  The top bar in the Android app is back to its normal height. A spacing fix
  meant for iPad was also adding empty space above the header on Android.
tags: [client]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- The extra top spacing that keeps the header clear of the iPad window controls now applies only to the iOS app. The Android app uses its normal header height again.
