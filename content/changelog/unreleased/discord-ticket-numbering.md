---
title: "Discord ticket numbers stay in one shared sequence"
date: "2026-10-09"
---

Discord bot and staff-created tickets reserve their number from the same atomic game counter before a channel is created. The reservation includes the highest numbered ticket already present in Discord, so existing channels remain in sequence after a counter repair. Reusing a number for a different Discord channel now returns a conflict instead of linking the report to the wrong ticket.
