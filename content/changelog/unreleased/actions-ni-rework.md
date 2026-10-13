---
date: 2026-10-13
title: Actions and national influence rework
summary: >-
  National influence now fades when it is not maintained and settles at a level
  set by the roles you hold. Chamber leaders and Supreme Court justices earn
  extra actions, office action pools refill a little every few turns instead of
  at midnight, and the governing party pays for holding power in home-state
  influence.
tags: [balance, national influence, actions, elections, leadership]
badges: [major]
areas: [engine, fullstack]
---

## What changed

- National influence decays 1% of its value every turn, then gains the turn's influence. Each role settles at 100 times its per-turn gain, and a reputation fades by half over about 69 turns after leaving office.
- The state influence term is steeper at both ends: 0 state influence costs 0.5 national influence per turn, 25 is neutral, 50 earns 0.5, 75 earns 1.25 and 100 earns 2.0.
- Position tiers: heads of government 2.5; vice presidents, presiding officers, majority leaders and national party chairs 2.0; cabinet members, governors, Supreme Court justices, the central bank chair, minority leaders and the CPPCC chair 1.5; national legislators and ceremonial heads of state 1.0; acting cabinet members 0.75; state legislators and state party chairs 0.5.
- CEOs of the 10 largest listed corporations in their country earn 0.3 national influence per turn, and CEOs of other listed corporations in the top half of their country by market cap earn 0.15, after running the same corporation for 12 turns. CEOs earn no extra actions.
- Holding an international organisation's leadership seat adds 1.0 national influence per turn on top of your domestic position.
- Members of the party holding the national executive lose state influence faster: 1.5 times the normal decay at 50% government approval, 2 times at 0% and the normal rate at 100%.
- Chamber leadership earns actions on top of the seat: presiding officers +3; majority leaders, minority leaders and the Leader of the Opposition +2; the President pro tempore, CPPCC chair, whips and shadow cabinet members +1. Only the highest role counts.
- Supreme Court justices earn +2 actions per turn on top of any other office. Write an Opinion grants 0.5 national influence instead of political influence.
- Office action bonuses follow each country's own office table. Ceremonial heads of state no longer earn a head of government's +4 actions, Chinese and Russian premiers earn +4 and the French prime minister +3.
- Ministerial actions regain 1 action every 6 turns up to 4. Vice president and Supreme Court actions regain 1 every 12 turns up to 2. These no longer reset at midnight Eastern time.
- You can spend 10 actions to buy 1 office action (ministerial, vice president, Supreme Court or gubernatorial), once per pool per turn, up to the pool's cap.
- The head of an international organisation has an agenda pool of 2 actions per turn, banking up to 4, for proposals inside that organisation.
- Campaign actions bank up to 48 turns of the campaign's own income.
- The central bank chair earns the 1.5 national influence tier instead of a separate bonus. Above 25 infamy the chair still loses 1.5 actions per turn.
