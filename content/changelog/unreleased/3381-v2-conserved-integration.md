---
date: 2026-10-07
title: Conserved financing covers Cabinet departments (off by default)
summary: >-
  When the opt-in conserved financing model is on, countries running the new
  Cabinet pay department funding from real Treasury cash after debt service,
  and any shortfall stays on the books as unpaid authority. No world runs it.
tags: [economy, treasury, cabinet]
# One of: major | minor | patch | hotfix
badges: [patch]
# Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Under the opt-in switch, a new-Cabinet country's tax cash is collected once, before debt service, from its existing household money stock.
- Department funding is paid afterward from the Treasury's real remaining cash, in priority order, and returned to the same stock. Shortfalls stay as unpaid authority per department.
- Bond sale proceeds and debt payments are already in the Treasury balance, so they are not counted a second time.
- Worlds without the switch keep today's behavior.
- If other Treasury spending lands between planning and payment and leaves too little cash, that turn pays no department and every claim stays owed; the next turn pays it from fresh cash instead of retrying the same payment forever.
- A payment interrupted after the Treasury was debited always finishes with its original amounts.
