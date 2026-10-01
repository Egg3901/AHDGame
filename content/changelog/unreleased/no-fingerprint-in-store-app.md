---
date: 2026-10-01
title: No device fingerprinting in the phone app
summary: >-
  The phone app no longer fingerprints your device when you sign in or sign up.
  It identifies itself with the app's own device key instead.
tags: [privacy, mobile, sign-in]
badges: [patch]
areas: [frontend]
---

## What changed

- `generateFingerprintData` returns nothing for the `AHDClient-Mobile/` user agent, so login, registration and the OAuth result page skip ThumbmarkJS and the fingerprint beacon. Apple does not allow device fingerprinting for any purpose.
- Fingerprint components are only sent together with a fingerprint, so the server never stores an empty component set.
- Removed the unused `RecordFingerprintOnMount` component.
