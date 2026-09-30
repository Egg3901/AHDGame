---
date: 2026-09-30
title: Hide Lakeside sign-in in the phone app
summary: >-
  The phone app no longer shows "Sign in with Lakeside", which only works for
  accounts already moved to Lakeside sign-in. Everyone else signs in with
  email, Apple or Discord as before.
tags: [sign-in, mobile]
badges: [patch]
areas: [frontend]
---

## What changed

- The Lakeside button carries `store-app-hidden`, so pages loaded by the phone app hide it. Browsers and the desktop client still show it.
