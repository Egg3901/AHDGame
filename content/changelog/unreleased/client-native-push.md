---
date: 2026-09-08
title: Native push notifications for AHDClient
summary: >-
  Mobile players can opt into private inbox alerts in AHDClient. New election,
  corporation and other inbox activity respects existing mute and snooze preferences.
tags: [client, notifications]
badges: [minor]
areas: [backend]
---

## What changed

- Add account-bound device registration and revocation for native mobile notifications.
- Deliver private inbox previews through APNs and FCM outside the turn loop.
- Respect inbox mutes and snoozes, skip routine income alerts, and retire expired devices.
