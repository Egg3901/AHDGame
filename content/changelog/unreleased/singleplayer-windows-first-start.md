---
date: 2026-09-06
title: Local worlds no longer freeze on their first start on Windows
summary: >-
  On Windows a new local world could sit at "still building the world" for
  minutes and then give up, while the same build started in seconds on Linux.
  The game server was started on the launcher's own input and output handles,
  and on Windows that left it accepting connections without ever answering.
  The server now runs on its own captured output, loads only the pages it is
  asked for, stops its database cleanly when you quit, and the launcher says
  which step it is on and why a step failed.
tags: [singleplayer, desktop, windows, launcher]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The game server's output is now captured by the launcher instead of being
  shared with it. On Windows, sharing those handles left the server accepting
  connections but never answering, for as long as anyone waited; this was the
  freeze. Capturing the output is also what lets a failure report show what
  the server said.
- The local game server no longer preloads all of its pages and routes at
  startup, which held every request for four seconds on Linux and seven on
  Windows. Only the multiplayer site needs that; a local world loads pages as
  it goes.
- The launcher now reports each startup step in plain words: starting the
  database, starting the game server, loading the game's code, preparing your
  account. Each step has its own deadline and a failure names the step, shows
  the last lines the game server printed and the tail of the database log.
- Errors the server reports while starting are shown instead of hidden behind
  a timeout, and a server that is not in singleplayer mode is reported at once.
- A cached MongoDB download that no longer runs is fetched again once. Other
  database exits are explained: port in use, data files from a different
  MongoDB version, missing Visual C++ runtime on Windows.
- First-run world setup no longer writes operator audit rows or per-query
  observability records; a local world has no operator to read them.
- Closing the game now stops the local database through its own shutdown
  command on every platform, and waits for it to finish before the launcher
  exits. On Windows the database used to be cut off hard, which could lose
  the last moment of writes; after "end turn" that was the write recording
  that the turn had finished, so a world could reopen mid-turn. On Linux and
  macOS a quick restart could find the previous database still closing.

## What it means at the table

- A new local world on Windows should be ready within seconds of the window
  opening, in line with Linux and macOS.
- If a start does fail, the message says what was being attempted and what the
  game saw, which is what to include in a bug report.
- Quitting right after ending a turn keeps that turn. Reopening a world
  straight after closing it works first time.
