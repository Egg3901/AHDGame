---
date: 2026-09-10
title: Add account deletion command primitives
summary: Add tested internal command state for future resumable account cleanup.
tags: [auth]
badges: [patch]
areas: [backend]
---

Adds internal reservation and worker lease primitives. Existing account deletion
routes do not use these primitives yet.
