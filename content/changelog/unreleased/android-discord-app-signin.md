---
date: 2026-10-07
title: Android app can sign in with the Discord app
summary: >-
  The site now publishes the Android app link file, so signing in with
  Discord can hand off to the Discord app and return to AHDClient.
tags: [mobile, auth]
badges: [patch]
areas: [frontend]
---

## What changed

- The site serves `/.well-known/assetlinks.json` for the AHDClient Android
  app, which lets Discord sign-in return to the app instead of a browser.
