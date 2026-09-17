---
date: "2026-09-10"
title: "Source password ownership helper for future migration"
badges: [patch]
areas: [backend]
tags: [auth]
---

# Source password ownership helper for future migration

Adds a dormant helper that checks a freshly loaded password-only account
against a supplied password. It is not a login, session, or migration
endpoint, and it changes no live auth behavior.
