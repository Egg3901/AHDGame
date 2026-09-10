---
date: "2026-09-10"
title: "Source security snapshot helper for future ownership proof binding"
badges: [patch]
areas: [backend]
tags: [auth]
---

# Source security snapshot helper for future ownership proof binding

Adds an internal snapshot helper that is not yet called by routes that encodes a loaded
account's password, provider, role, and revocation state with its source
binding into a versioned canonical JSON value and SHA256 digest.

This is not ownership proof, authentication, or authorization, and it changes
no login, session, or migration behavior. It only prepares the binding a later
ownership-proof ceremony will need, so a future proof cannot stay valid after
security state changes. Fenced and deletion-pending rows are rejected before
encoding.
