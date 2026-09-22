---
date: 2026-09-09
title: Countries are now checked against the era they are in
summary: >-
  A world set in 2019 was giving Poland, Hungary, Romania and Bulgaria the
  constitutional clause that made the communist party the only legal party. Each
  era now has its own policy set, and the readiness checks read the era instead
  of assuming the modern one.
tags: [countries, presets, policy, seeding, readiness]
badges: [minor]
areas: [backend, engine]
---

Cut from development.

## Fixed

- Worlds set in 2019 no longer give Poland, Hungary, Romania, Bulgaria, Belarus
  or Ukraine one-party constitutional policy. Those countries now start with the
  policy levers a modern state has.
- The Soviet Union, East Germany, Czechoslovakia, Yugoslavia and the Baltic
  republics no longer contribute policy to worlds set after they ceased to exist.
- Country readiness now answers for the era being asked about. It previously
  credited Russia with the Communist Party of the Soviet Union in a 2019 world,
  and reported Germany's region count against the reunified sixteen even in a
  1953 world that correctly seeds eleven.
- The seed report no longer asks for data from countries an era does not
  contain, so a correct reset no longer reports East Germany as missing.

## Changed

- Where a country's content is known to be incomplete, the gap is now recorded
  with a reason rather than a bare flag, and it shows up in the readiness view.
