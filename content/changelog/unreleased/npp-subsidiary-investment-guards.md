---
title: Protect NPP investments and focus subsidiary industries
badges: [patch]
areas: [engine, fullstack]
tags: [corporations, subsidiaries, npp]
---

- NPP CEOs keep sectors while construction is unfinished and allow new sectors their founding build period plus 24 turns before automatic divestment.
- Group leaders can restrict an NPP subsidiary's new sectors and capacity investment to its primary industry from Group > Directions. Existing groups remain unrestricted unless this option is selected.
- Industry restrictions take effect next turn and do not delete existing off-industry sectors.

Migration: no backfill is required. The optional direction field defaults to unrestricted, uses the existing corporation lifecycle/reset, and is ignored when its group or CEO tenure is no longer current. New NPP sectors record an optional birth turn in every market mode; older plants sectors use their existing plants start turn. Older legacy sectors without either turn keep their existing maturity policy. Sector deletion during world reset clears the new field. No production balances or deleted sectors are restored by this change.
