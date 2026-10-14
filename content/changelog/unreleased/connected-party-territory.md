---
date: 2026-10-14
title: Connected party territory and reconnection-only growth
summary: Disconnected parties can grow toward reconnecting their regions, and relocation preserves connecting footholds.
tags: [parties, geography, recruitment]
badges: [patch]
areas: [backend]
---

- Parties with disconnected territory can recruit and accept members in existing regions or along paths that help reconnect their areas. Normal adjacent growth resumes when connected.
- Territory is checked live, including after a member leaves. Leaving a party remains allowed.
- Player and NPP relocation cannot remove a connecting foothold unless other party presence preserves the connection. The check includes combined character and corporation moves.
- Geographic changes are serialized across server processes. An interrupted server process fails closed; staff must reconcile the operation before clearing its claim.
- Runtime-generated CEOs and justices become Independent if their requested affiliation would establish an ineligible party foothold.
