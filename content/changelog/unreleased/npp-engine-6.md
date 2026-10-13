---
date: 2026-10-13
title: "NPP engine 6.0: its own version line, changelog and roadmap"
summary: Non-player politician behavior gets a versioned engine with a separate changelog and roadmap, a new autonomy tier v6 that switches on engine 6 behavior, and a staggered NPP action cycle at v6.
tags: [npp, autonomy, performance]
badges: [minor]
areas: [backend, engine]
---

## What changed

- **NPP engine changelog.** NPP behavior now has its own version line, starting at engine 6.0.0, with a changelog and the overhaul roadmap at [/changelog/npp](/changelog/npp). The main feed links to it. Earlier autonomy tiers are recorded as engine 0.x to 5.x.
- **Autonomy tier v6.** A new tier above v5 that switches on engine 6 behavior. It allows exactly the activities and resources of v5. No running world changes level: production stays on v4, fresh worlds still default to v4.
- **Staggered action cycle at v6.** NPPs take an action cycle once every four turns. Below v6 all of them act on the same turn; at v6 each NPP has a fixed lane and a quarter act on each turn. Each NPP still acts once every four turns with the same action points. Share and bond buying follow the lane; share selling, party organisation building and company founding stay on the shared fourth turn.
- **Engine version on turn logs.** Each turn log records the NPP engine version it ran.
- **Wiki.** The NPP autonomy page now covers v5 and v6.

## Why

On live turn 168 the shared action cycle took 27.6 seconds (18.0 s share buying, 4.7 s bond buying) on one turn in four and about 5 ms on the other three.

## Scope

Behavior changes only in worlds set to autonomy v6. Worlds at v5 and below are unchanged, apart from one extra settings read on turns between action cycles.
