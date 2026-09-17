---
date: 2026-09-17
title: Shared Fundraise rules
summary: Fundraise action cost, yield and eligibility share a portable rules module.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Fundraise quotes and effects use the same portable AP, yield and eligibility rules. Existing balance, the flat 3 AP cost, the influence-scaled base and stat multipliers are preserved.
- Fundraise validation and the effect reject a zero donor base with the quoted reason instead of pricing a yield that cannot be earned.
- The UI card, the AI advisor and the client-status projection now quote the same stat-scaled yield the execute shell credits, fixing previews that understated payment for characters with allocated fundraising stats.
