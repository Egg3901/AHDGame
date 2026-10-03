---
date: 2026-10-03
title: World resets keep cross-game data
summary: A reset no longer drops moderation reports, login history, wiki politician pages, event templates, or site analytics, and a full reset keeps banned and staff accounts.
tags: [reset, moderation, wiki]
badges: [patch]
areas: [backend, frontend]
---

- Keep login and logout history (IP, device, tracking id) through a reset so alt detection and the moderation dossier still see it; world activity rows are still cleared.
- Keep the mail and content report queues, wiki politician pages, random-event templates with their approvals, site traffic, and code quality history.
- Snapshot a reported message onto its report, so moderators can still read it after a reset or after both players delete it.
- Keep banned, admin, and moderator accounts through a full reset, so a ban survives and the moderation team can make new characters.
