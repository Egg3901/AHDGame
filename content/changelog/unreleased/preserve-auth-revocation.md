---
date: 2026-09-10
title: More reliable sign-in after signing out
summary: Password, Discord and Google sign-in now handle recent sign-outs consistently.
tags: [auth, sessions]
badges: [patch]
areas: [backend]
---

- Keep previous sign-outs effective when signing in again.
- Retry safely when account access changes during sign-in.
