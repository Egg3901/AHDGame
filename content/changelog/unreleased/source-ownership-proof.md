---
date: "2026-09-10"
title: "Source password ownership proof kernel"
badges: [patch]
areas: [backend]
tags: [auth]
---

# Source password ownership proof kernel

New disconnected durable proof kernel for later account migration work.
After a fresh password check, it binds one source account to one enrollment
operation for 5 minutes inside a required transaction, with no sign-in,
fence, role, or session changes. Wrong passwords and concurrent credential
changes write nothing, and uncertain commits report a stable proof id for
authenticated reconciliation instead of claiming success or failure.
