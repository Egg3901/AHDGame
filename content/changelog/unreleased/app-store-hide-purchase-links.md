---
date: 2026-09-30
title: Hide supporter purchase links in the phone app
summary: >-
  The A House Divided phone app no longer shows Patreon or subscription links,
  as App Store and Play rules require. Existing supporters keep every perk and
  setting; the links still appear in browsers and the desktop client.
tags: [supporters, mobile]
badges: [patch]
areas: [frontend]
---

## What changed

- Pages opened by the phone app (`AHDClient-Mobile/` user agent) mark the document, and CSS hides every `.store-purchase-cta`: the Patreon and supporter wall links in the help menus, the landing page Patreon card, the settings tier prices, the subscribe overlay button and the manage subscription link.
- Locked supporter controls in the app read "Supporter feature" instead of "Subscribe to unlock this".
