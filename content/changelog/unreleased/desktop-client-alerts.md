---
date: 2026-10-10
title: Inbox alerts on the desktop client
summary: >-
  The desktop client can now show your inbox alerts as system notifications
  while it is open, using the same rules as phone alerts.
tags: [client, notifications]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The desktop client checks for new inbox alerts once a minute while it is open and shows each one as a system notification with its own title, message and category.
- Desktop alerts follow the same rules as phone alerts: muted and snoozed alert types stay quiet, routine turn income stays in the inbox, and anything older than a day is skipped.
- Signing in on a new install starts from your current inbox, so you are not flooded with old alerts.
