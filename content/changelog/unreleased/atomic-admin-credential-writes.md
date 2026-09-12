---
date: 2026-09-10
title: More reliable admin password resets
summary: Admin password resets confirm the credential write and detect concurrent account changes.
tags: [auth, sessions]
badges: [patch]
areas: [backend]
---

- Admin password resets confirm the credential write before reporting success, and report a conflict when the account changed mid-request.
- Resetting a password revokes existing sessions. Reset links issued before a password change require a fresh request.
- A banned account can still receive an authorized admin password reset; the reset never changes ban state.
