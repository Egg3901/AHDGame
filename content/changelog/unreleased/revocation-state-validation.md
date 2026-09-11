---
date: 2026-09-10
title: Validate stored session revocation state
summary: Session checks consistently require valid account revocation data.
tags: [auth]
badges: [patch]
areas: [backend]
---

Session validation now uses the same revocation rules across account profiles,
session checks, and credential changes.
