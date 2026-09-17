---
date: 2026-09-10
title: More reliable sign-out and password updates
summary: Sign-out confirms session revocation, and password updates detect concurrent account changes.
tags: [auth, sessions]
badges: [patch]
areas: [backend]
---

- Sign-out confirms session revocation before reporting success.
- Password updates detect competing changes. Reset links issued before a password change require a fresh request.
- Setting a first password now signs out existing sessions.
