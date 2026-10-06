---
date: 2026-10-06
title: Google and Apple signup follow test mode
summary: >-
  While a world is in test mode, new accounts can only be created with the
  test code on the email form. Google and Apple signup now close the same way
  Discord signup already did.
tags: [accounts, sandbox]
badges: [patch]
areas: [backend]
---

## What changed

- Signing up with Google or Apple on a world in test mode now shows the test mode message instead of creating an account. Existing accounts still sign in with Google or Apple as before.
- The signup page marks Google and Apple as unavailable while test mode is on, matching Discord.
