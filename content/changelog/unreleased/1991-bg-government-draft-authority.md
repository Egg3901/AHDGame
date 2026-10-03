---
date: 2026-10-03
title: Bulgarian governments can introduce constitutional drafts
summary: >-
  An NPC government can introduce its constitutional draft without already
  controlling the adoption vote. Player deputies keep their own votes.
tags: [1991, bulgaria, parliament, constitution]
badges: [patch]
areas: [backend, engine]
---

## What changed

- A formed NPC government can introduce a draft in a mixed player and NPC Grand Assembly, including a minority government.
- Introduction leaves adoption to the normal constituent vote, which still needs 267 of all 400 deputies.
- The opening transaction rechecks the current government and sponsor. A player PM, caretaker government, changed party or missing sponsor prevents stale introduction.
- Existing drafts and failed-vote history are preserved. No deputy's vote, office or financial balance changes when a draft opens.
