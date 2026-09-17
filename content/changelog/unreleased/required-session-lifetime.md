---
date: 2026-09-10
title: Stricter session token checks
summary: Sign-in sessions now validate the token algorithm and timestamps more strictly.
tags: [auth, sessions]
badges: [patch]
areas: [backend]
---

- Session tokens are now accepted only from the expected signing algorithm
  with valid issue and expiry timestamps.
- Ordinary sign-in sessions are unaffected; no action needed.
