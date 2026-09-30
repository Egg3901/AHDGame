---
date: 2026-09-30
title: Sign in with Apple and smoother sign-in
summary: >-
  You can now create an account, sign in, or link your existing account with
  your Apple ID. Signing in with Apple, Google or Discord now takes you straight
  back into the game, and linking Discord from Settings works again.
tags: [accounts, sign-in, mobile]
badges: [minor]
areas: [fullstack]
---

## What changed

- Sign in with Apple on the login and register pages, and a link/unlink card in Settings > Identity. Apple's private relay email is supported; the game never needs the real address.
- Deleting an account that used Apple revokes the Apple grant, as App Store review requires.
- After a successful Apple, Google or Discord sign-in the result page continues immediately instead of counting down.
- Fixed: linking Discord from Settings or character creation always failed with "session expired", because Discord returns to www while the link cookie lives on the apex domain. OAuth callbacks on www now hop to the apex first.
- Fixed: the OAuth result pages followed any `next` value, including other sites and `javascript:` URLs. Only same-site paths and the Lakeside SSO return are followed now.
- "Sign in with Lakeside" failures now explain what happened instead of silently returning to the login page.
- In the phone app, the Google button is hidden: Google blocks its sign-in inside app webviews.
