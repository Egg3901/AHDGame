---
date: 2026-10-09
title: Phone alerts show what happened
summary: >-
  Push alerts in the iOS and Android apps now show the alert's own title and message, its
  inbox category, and how many more are waiting, instead of a generic "new activity" line.
tags: [notifications, mobile]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- A push alert carries the newest inbox alert's title and message, its category (Election, Legislation, Crisis and so on), and a count of the other unread alerts that arrived with it.
- Alerts are grouped by category in the notification list, and a retried delivery replaces itself instead of stacking.
- Tapping an alert in AHDClient 2.4 opens the page it is about (the election, bill, crisis or corporation). Older app versions still open the inbox.
- Mutes, snoozes, read and archived alerts behave as before. Lock-screen visibility follows your phone's notification preview setting.
- The app widgets can now show the current turn, when the next turn runs, and your unread inbox and mail counts.
