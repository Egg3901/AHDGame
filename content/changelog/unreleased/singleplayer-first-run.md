---
date: 2026-09-09
title: Local worlds start with your character
summary: Native world setup leads into character creation, with local session navigation and character-gated turns.
tags: [singleplayer, client, navigation]
badges: [patch]
areas: [fullstack]
---

Local worlds open character creation instead of the old Control Room. Hosted
maintenance no longer hides a local game. Pause stops the next turn while the
world stays readable, and normal player worlds cannot advance until a character
exists. Worldsim remains playerless.

Both game navigation styles recognise the local session and keep account sign-in
and sign-out controls out of singleplayer. The desktop account summary also
provides a trusted profile image for the launcher.

Turn progress appears only in singleplayer, stays centered on small screens, and
reports disconnected or stale processing instead of spinning indefinitely.
Completed turns refresh the shared clock and character data immediately, with a
briefing of actual campaign-fund and action changes. Nonfatal engine warnings no
longer make a completed local or Worldsim turn appear to have failed.
