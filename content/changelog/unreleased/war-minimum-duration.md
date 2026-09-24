---
date: 2026-09-24
title: Improve war resolution and alliance defence
summary: >-
  Wars can no longer end from a momentary return to the defender's starting
  line. Armed blocs also see war risks on membership applications and can vote
  to extend collective defence to a new member's existing war.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [military, wars, territory]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine, frontend]
---

## What changed

- Adds a 24-turn minimum before complete territorial control can end a war.
- Keeps an untouched defender's opening 100 percent ownership from counting as
  a victory, while allowing a genuinely recaptured pole to mature on schedule.
- Resolves an eligible pole automatically even when no battle happens on the
  twenty-fourth turn.
- Warns NATO and Warsaw Pact members when an applicant is already at war or is
  the target of a pending declaration.
- Lets members unanimously extend collective defence to an applicant's live
  defensive war. A passed vote brings eligible allies in immediately without
  national legislation.
