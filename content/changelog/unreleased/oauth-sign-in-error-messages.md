---
date: 2026-10-05
title: Clearer sign-in errors for Google, Discord, and Apple
summary: >-
  When a Google, Discord, or Apple sign-in can't create a new account, the
  error page now says why instead of reporting that account linking failed.
tags: [account]
badges: [patch]
areas: [frontend]
---

## What changed

- Sign-ins blocked by the new-account rules now explain that a new account can't be created from this device or location, and point you to the sign-in method you originally used.
- Sign-ins during maintenance now say that new accounts can't be created until maintenance ends.
- The fallback error now reads as a sign-in failure, not a linking failure, and blocked sign-ins return you to the login page.
