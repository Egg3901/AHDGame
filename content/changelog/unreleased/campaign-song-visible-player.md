---
date: 2026-10-01
title: Campaign songs play in YouTube's own player
summary: >-
  Campaign songs no longer autoplay. Press Play on a profile to open the song in
  YouTube's standard player, right there in the profile. The phone app does not
  show campaign songs.
tags: [profiles, campaign-songs, mobile]
badges: [minor]
areas: [frontend]
---

## What changed

- The campaign song on player, character and imperial profiles is a compact row (thumbnail, song label, Play). Play opens YouTube's own visible player (privacy-enhanced embed) at full card width; Close removes it. Nothing loads from YouTube until Play is pressed.
- The previous player hid a 1px YouTube player and played its audio in the background, which YouTube's terms do not allow and App Store review rejects.
- Removed the "Enable autoplay on my profile" and "Disable autoplay on other users' profiles" settings and the autoplay-preference API route. Stored values are ignored.
- The phone app hides campaign songs entirely.
- Character pages no longer read the viewer's account for the autoplay preference.
