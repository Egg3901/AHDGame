---
date: 2026-10-02
title: Enforce national NPP capacity on party mergers
summary: Party mergers now remove incoming NPPs above regional or active-player capacity and explain the consequences before proposing or voting.
tags: [parties, mergers, recruitment]
badges: [patch]
areas: [fullstack]
---

## What changed

- Apply the national limit of five NPPs per active player, up to 25, to incoming active NPPs after regional merger selection.
- Count the combined party's qualifying active members when the merger resolves.
- Always retain the surviving party's existing NPPs, including an already-over-cap roster; in that case no incoming active NPPs survive.
- Keep the strongest eligible incoming NPPs by influence, favorability and stable ID order.
- Remove deleted NPPs from both supported candidacy ID formats and archive their campaigns.
- Show one consistent, localized deletion warning on merger creation and both parties' open voting cards, including regional limits, national capacity, priority and officeholder consequences.
